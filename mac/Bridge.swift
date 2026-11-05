// Brücke zwischen der Mac-App und dem Assistenten (Server in Node.js).
//
// Die App holt ständig Aufträge ab („Gibt es etwas für mich?“) und erledigt alles, was nur eine echte
// Mac-App darf: Kalender und Erinnerungen (EventKit), Kontakte, WhatsApp-Daten lesen und Nachrichten
// abschicken, die Erlaubnis-Fenster von macOS – und Apple Intelligence.

import Cocoa
import EventKit
import Contacts
import SQLite3
import CoreServices
import ApplicationServices
import UserNotifications

struct BridgeFailure: Error {
    let message: String
    let code: String
    init(_ message: String, code: String = "error") {
        self.message = message
        self.code = code
    }
}

typealias BridgeReply = (Result<Any?, BridgeFailure>) -> Void

/// Ruft Werkzeuge im Server auf (für Apple Intelligence). Eigene kleine Klasse, damit sie „Sendable“ sein darf.
final class ToolCaller: @unchecked Sendable {
    let baseURL: URL
    let key: String
    let session: URLSession

    init(baseURL: URL, key: String, session: URLSession) {
        self.baseURL = baseURL
        self.key = key
        self.session = session
    }

    func callTool(runId: String, name: String, json: String) async -> String {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/intern/tool"))
        req.httpMethod = "POST"
        req.timeoutInterval = 180
        req.setValue(key, forHTTPHeaderField: "x-assistent-app")
        req.setValue("1", forHTTPHeaderField: "x-assistent")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["runId": runId, "name": name, "arguments": json], options: [])
        do {
            let (data, _) = try await session.data(for: req)
            if let obj = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any], let out = obj["output"] as? String {
                return out
            }
            return "Fehler: Keine Antwort vom Assistenten."
        } catch {
            return "Fehler: \(error.localizedDescription)"
        }
    }
}

final class MacBridge: NSObject {
    let baseURL: URL
    let key: String
    let session: URLSession
    let caller: ToolCaller
    var running = false
    var polling = false
    var pollFailed = false
    var helloTimer: Timer?
    var eventStore = EKEventStore()
    let contactStore = CNContactStore()
    let work = DispatchQueue(label: "de.assistent.bridge", qos: .userInitiated, attributes: .concurrent)
    let waBundleIDs = ["net.whatsapp.WhatsApp", "desktop.WhatsApp"]

    init(baseURL: URL, key: String) {
        self.baseURL = baseURL
        self.key = key
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 900
        config.httpMaximumConnectionsPerHost = 10
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
        self.caller = ToolCaller(baseURL: baseURL, key: key, session: session)
        super.init()
    }

    // MARK: - Verbindung

    func start() {
        guard !running else { return }
        running = true
        sendHello()
        poll()
        helloTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.sendHello()
        }
    }

    func stop() {
        running = false
        helloTimer?.invalidate()
        helloTimer = nil
    }

    private func makeRequest(_ path: String, method: String = "GET", body: Any? = nil, timeout: TimeInterval = 60) -> URLRequest {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = timeout
        req.setValue(key, forHTTPHeaderField: "x-assistent-app")
        req.setValue("1", forHTTPHeaderField: "x-assistent")
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
        }
        return req
    }

    func post(_ path: String, _ body: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(body) else {
            NSLog("Assistent: Antwort für \(path) ist kein gültiges JSON")
            return
        }
        session.dataTask(with: makeRequest(path, method: "POST", body: body)) { _, _, _ in }.resume()
    }

    func sendHello() {
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
        post("api/intern/bridge/hello", ["version": version, "ai": Intelligence.status(), "os": ProcessInfo.processInfo.operatingSystemVersionString])
    }

    private func poll() {
        guard running, !polling else { return }
        polling = true
        session.dataTask(with: makeRequest("api/intern/bridge/next", timeout: 45)) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            var requests: [[String: Any]] = []
            if ok, let data = data, let obj = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {
                requests = obj["requests"] as? [[String: Any]] ?? []
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.polling = false
                for r in requests { self.handle(r) }
                if ok {
                    // Server neu gestartet? Dann wieder melden (Apple Intelligence, Version …)
                    if self.pollFailed {
                        self.pollFailed = false
                        self.sendHello()
                    }
                    self.poll()
                } else {
                    self.pollFailed = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.poll() }
                }
            }
        }.resume()
    }

    private func handle(_ r: [String: Any]) {
        guard let id = r["id"] as? String, let cmd = r["cmd"] as? String else { return }
        let args = r["args"] as? [String: Any] ?? [:]
        let reply: BridgeReply = { [weak self] result in
            switch result {
            case .success(let value):
                self?.post("api/intern/bridge/result", ["id": id, "ok": true, "result": value ?? NSNull()])
            case .failure(let f):
                self?.post("api/intern/bridge/result", ["id": id, "ok": false, "error": f.message, "code": f.code])
            }
        }
        run(cmd, args, reply)
    }

    /// Erledigt einen Auftrag im Hintergrund; Fehler kommen als BridgeFailure zurück.
    private func background(_ reply: @escaping BridgeReply, _ body: @escaping () throws -> Any?) {
        work.async {
            do {
                reply(.success(try body()))
            } catch let f as BridgeFailure {
                reply(.failure(f))
            } catch {
                reply(.failure(BridgeFailure(error.localizedDescription)))
            }
        }
    }

    private func run(_ cmd: String, _ a: [String: Any], _ reply: @escaping BridgeReply) {
        switch cmd {
        case "permissions":
            background(reply) { self.permissionStatus() }
        case "permission.request":
            requestPermission(a["kind"] as? String ?? "") { status in reply(.success(["status": status])) }
        case "calendar.calendars":
            background(reply) { ["calendars": try self.calendars()] }
        case "calendar.events":
            background(reply) { ["events": try self.events(a)] }
        case "calendar.create":
            background(reply) { ["event": try self.createEvent(a)] }
        case "calendar.update":
            background(reply) { ["event": try self.updateEvent(a)] }
        case "calendar.delete":
            background(reply) { try self.deleteEvent(a) }
        case "reminders.lists":
            background(reply) { ["lists": try self.reminderLists()] }
        case "reminders.list":
            reminders(a, reply)
        case "reminders.create":
            background(reply) { ["reminder": try self.createReminder(a)] }
        case "reminders.update":
            background(reply) { ["reminder": try self.updateReminder(a)] }
        case "reminders.delete":
            background(reply) { try self.deleteReminder(a) }
        case "contacts.search":
            background(reply) { ["contacts": try self.searchContacts(a)] }
        case "whatsapp.query":
            background(reply) { try self.whatsappQuery(a) }
        case "whatsapp.send":
            whatsappSend(a, reply)
        case "whatsapp.open":
            whatsappOpen(a, reply)
        case "notify":
            notify(a)
            reply(.success(["ok": true]))
        case "ai.respond":
            Intelligence.respond(a, caller: caller, done: reply)
        default:
            reply(.failure(BridgeFailure("Unbekannter Auftrag: \(cmd)", code: "unknown")))
        }
    }

    // MARK: - Hilfen

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    static func date(ms: Any?) -> Date? {
        guard let n = ms as? NSNumber else { return nil }
        return Date(timeIntervalSince1970: n.doubleValue / 1000)
    }

    static func dayString(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func dayDate(_ s: Any?) -> Date? {
        guard let s = s as? String else { return nil }
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func hex(_ color: CGColor?) -> Any {
        guard let color = color, let ns = NSColor(cgColor: color)?.usingColorSpace(.sRGB) else { return NSNull() }
        return String(format: "#%02x%02x%02x", Int(ns.redComponent * 255), Int(ns.greenComponent * 255), Int(ns.blueComponent * 255))
    }

    // MARK: - Berechtigungen

    func ekStatus(_ type: EKEntityType) -> String {
        let s = EKEventStore.authorizationStatus(for: type)
        switch s {
        case .notDetermined: return "unknown"
        case .restricted, .denied: return "denied"
        default:
            if #available(macOS 14.0, *) {
                if s == .writeOnly { return "denied" }
            }
            return "granted"
        }
    }

    func automationStatus(_ bundleID: String, ask: Bool) -> String {
        if NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) == nil { return "notInstalled" }
        var addr = AEAddressDesc()
        let created: OSErr = bundleID.withCString { ptr in
            AECreateDesc(DescType(typeApplicationBundleID), ptr, Int(strlen(ptr)), &addr)
        }
        guard created == 0 else { return "unknown" }
        defer { AEDisposeDesc(&addr) }
        let status = AEDeterminePermissionToAutomateTarget(&addr, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
        let memo = "steuern.\(bundleID)"
        if status == 0 {
            UserDefaults.standard.set("granted", forKey: memo)
            return "granted"
        }
        if status == OSStatus(errAEEventNotPermitted) {
            UserDefaults.standard.set("denied", forKey: memo)
            return "denied"
        }
        // Läuft die App gerade nicht, sagt macOS nichts – dann zählt die letzte Antwort
        return UserDefaults.standard.string(forKey: memo) ?? "unknown"
    }

    var whatsappContainer: String { NSHomeDirectory() + "/Library/Group Containers/group.net.whatsapp.WhatsApp.shared" }

    var whatsappInstalled: Bool {
        waBundleIDs.contains { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil }
    }

    func whatsappStatus() -> String {
        if !whatsappInstalled && !FileManager.default.fileExists(atPath: whatsappContainer) { return "notInstalled" }
        return UserDefaults.standard.string(forKey: "whatsappZugriff") ?? "unknown"
    }

    func permissionStatus() -> [String: String] {
        var st: [String: String] = [:]
        st["calendar"] = ekStatus(.event)
        st["reminders"] = ekStatus(.reminder)
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: st["contacts"] = "granted"
        case .notDetermined: st["contacts"] = "unknown"
        default: st["contacts"] = "denied"
        }
        st["mail"] = automationStatus("com.apple.mail", ask: false)
        st["notes"] = automationStatus("com.apple.Notes", ask: false)
        st["music"] = automationStatus("com.apple.Music", ask: false)
        st["whatsapp"] = whatsappStatus()
        st["accessibility"] = AXIsProcessTrusted() ? "granted" : "denied"
        return st
    }

    /// Fragt macOS nach der Erlaubnis – es erscheint ein Fenster, ein Klick genügt.
    func requestPermission(_ kind: String, done: @escaping (String) -> Void) {
        switch kind {
        case "calendar", "reminders":
            let type: EKEntityType = kind == "calendar" ? .event : .reminder
            let finish: (Bool, Error?) -> Void = { _, _ in
                DispatchQueue.main.async {
                    self.eventStore = EKEventStore()
                    done(self.ekStatus(type))
                }
            }
            if #available(macOS 14.0, *) {
                if type == .event {
                    eventStore.requestFullAccessToEvents(completion: finish)
                } else {
                    eventStore.requestFullAccessToReminders(completion: finish)
                }
            } else {
                eventStore.requestAccess(to: type, completion: finish)
            }
        case "contacts":
            contactStore.requestAccess(for: .contacts) { ok, _ in done(ok ? "granted" : "denied") }
        case "mail", "notes", "music":
            let ids = ["mail": "com.apple.mail", "notes": "com.apple.Notes", "music": "com.apple.Music"]
            let bundleID = ids[kind] ?? ""
            launchQuietly(bundleID) {
                self.work.async { done(self.automationStatus(bundleID, ask: true)) }
            }
        case "whatsapp":
            work.async { done(self.probeWhatsApp()) }
        case "accessibility":
            let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            let ok = AXIsProcessTrustedWithOptions(opts)
            done(ok ? "granted" : "denied")
        default:
            done("unavailable")
        }
    }

    func launchQuietly(_ bundleID: String, then: @escaping () -> Void) {
        if !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty {
            then()
            return
        }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
            then()
            return
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = false
        cfg.hides = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { then() }
        }
    }

    // MARK: - Kalender

    func needAccess(_ type: EKEntityType, _ name: String) throws {
        let st = ekStatus(type)
        if st == "granted" { return }
        throw BridgeFailure(st == "unknown" ? "\(name) ist noch nicht erlaubt." : "Kein Zugriff auf \(name).", code: st == "unknown" ? "unknown" : "denied")
    }

    func calendars() throws -> [[String: Any]] {
        try needAccess(.event, "den Kalender")
        let def = eventStore.defaultCalendarForNewEvents?.calendarIdentifier
        return eventStore.calendars(for: .event).map { c in
            ["id": c.calendarIdentifier, "title": c.title, "color": MacBridge.hex(c.cgColor), "writable": c.allowsContentModifications,
             "source": c.source?.title ?? "", "isDefault": c.calendarIdentifier == def]
        }
    }

    func eventDict(_ e: EKEvent) -> [String: Any] {
        let start = e.startDate ?? Date()
        let end = e.endDate ?? start
        var d: [String: Any] = [
            "id": "\(e.calendarItemIdentifier)|\(Int64(MacBridge.ms(start)))",
            "title": e.title ?? "",
            "startMs": MacBridge.ms(start),
            "endMs": MacBridge.ms(end),
            "allDay": e.isAllDay,
            "location": e.location ?? "",
            "notes": String((e.notes ?? "").prefix(3000)),
            "calendar": e.calendar?.title ?? "",
            "calendarId": e.calendar?.calendarIdentifier ?? "",
            "color": MacBridge.hex(e.calendar?.cgColor),
            "writable": e.calendar?.allowsContentModifications ?? false,
            "recurring": e.hasRecurrenceRules,
        ]
        if e.isAllDay {
            d["startDate"] = MacBridge.dayString(start)
            d["endDate"] = MacBridge.dayString(max(start, end.addingTimeInterval(-1)))
        }
        return d
    }

    func events(_ a: [String: Any]) throws -> [[String: Any]] {
        try needAccess(.event, "den Kalender")
        guard let from = MacBridge.date(ms: a["fromMs"]), let to = MacBridge.date(ms: a["toMs"]) else {
            throw BridgeFailure("Zeitraum fehlt.")
        }
        var cals: [EKCalendar]? = nil
        if let ids = a["calendarIds"] as? [String] {
            cals = eventStore.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
            if cals?.isEmpty == true { return [] }
        }
        let pred = eventStore.predicateForEvents(withStart: from, end: to, calendars: cals)
        return eventStore.events(matching: pred).map { eventDict($0) }
    }

    func findEvent(_ id: String) throws -> EKEvent {
        let parts = id.split(separator: "|", maxSplits: 1).map(String.init)
        guard let first = parts.first, let item = eventStore.calendarItem(withIdentifier: first) as? EKEvent else {
            throw BridgeFailure("Diesen Termin finde ich nicht mehr.", code: "notFound")
        }
        if parts.count == 2, let ms = Double(parts[1]), item.hasRecurrenceRules {
            let at = Date(timeIntervalSince1970: ms / 1000)
            let pred = eventStore.predicateForEvents(withStart: at.addingTimeInterval(-60), end: at.addingTimeInterval(86400), calendars: item.calendar.map { [$0] })
            if let occ = eventStore.events(matching: pred).first(where: { $0.calendarItemIdentifier == first && abs(($0.startDate ?? at).timeIntervalSince(at)) < 1 }) {
                return occ
            }
        }
        return item
    }

    func createEvent(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.event, "den Kalender")
        let e = EKEvent(eventStore: eventStore)
        e.title = a["title"] as? String ?? ""
        if (a["allDay"] as? Bool) == true {
            guard let s = MacBridge.dayDate(a["startDate"]) else { throw BridgeFailure("Datum fehlt.") }
            e.isAllDay = true
            e.startDate = s
            e.endDate = MacBridge.dayDate(a["endDate"]) ?? s
        } else {
            guard let s = MacBridge.date(ms: a["startMs"]) else { throw BridgeFailure("Beginn fehlt.") }
            e.startDate = s
            e.endDate = MacBridge.date(ms: a["endMs"]) ?? s.addingTimeInterval(3600)
        }
        if let loc = a["location"] as? String, !loc.isEmpty { e.location = loc }
        if let notes = a["notes"] as? String, !notes.isEmpty { e.notes = notes }
        if let calId = a["calendarId"] as? String, let cal = eventStore.calendar(withIdentifier: calId) {
            e.calendar = cal
        } else {
            e.calendar = eventStore.defaultCalendarForNewEvents
        }
        try eventStore.save(e, span: .thisEvent, commit: true)
        return eventDict(e)
    }

    func updateEvent(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.event, "den Kalender")
        let e = try findEvent(a["id"] as? String ?? "")
        guard e.calendar?.allowsContentModifications ?? false else { throw BridgeFailure("Dieser Kalender kann nur gelesen werden.") }
        if let t = a["title"] as? String { e.title = t }
        if let l = a["location"] as? String { e.location = l }
        if let n = a["notes"] as? String { e.notes = n }
        let duration = (e.endDate ?? Date()).timeIntervalSince(e.startDate ?? Date())
        if let s = MacBridge.dayDate(a["startDate"]) {
            e.isAllDay = true
            e.startDate = s
            e.endDate = MacBridge.dayDate(a["endDate"]) ?? s
        } else if let s = MacBridge.date(ms: a["startMs"]) {
            e.isAllDay = false
            e.startDate = s
            e.endDate = MacBridge.date(ms: a["endMs"]) ?? s.addingTimeInterval(max(duration, 900))
        } else if let end = MacBridge.date(ms: a["endMs"]) {
            e.endDate = end
        } else if let endDay = MacBridge.dayDate(a["endDate"]) {
            e.endDate = endDay
        }
        try eventStore.save(e, span: .thisEvent, commit: true)
        return eventDict(e)
    }

    func deleteEvent(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.event, "den Kalender")
        let e = try findEvent(a["id"] as? String ?? "")
        guard e.calendar?.allowsContentModifications ?? false else { throw BridgeFailure("Dieser Kalender kann nur gelesen werden.") }
        try eventStore.remove(e, span: .thisEvent, commit: true)
        return ["ok": true]
    }

    // MARK: - Erinnerungen

    func reminderLists() throws -> [[String: Any]] {
        try needAccess(.reminder, "die Erinnerungen")
        let def = eventStore.defaultCalendarForNewReminders()?.calendarIdentifier
        return eventStore.calendars(for: .reminder).map { c in
            ["id": c.calendarIdentifier, "title": c.title, "color": MacBridge.hex(c.cgColor), "isDefault": c.calendarIdentifier == def]
        }
    }

    func reminderDict(_ r: EKReminder) -> [String: Any] {
        var d: [String: Any] = [
            "id": r.calendarItemIdentifier,
            "title": r.title ?? "",
            "notes": String((r.notes ?? "").prefix(2000)),
            "priority": (r.priority >= 1 && r.priority <= 4) ? "hoch" : "normal",
            "completed": r.isCompleted,
            "list": r.calendar?.title ?? "",
            "listId": r.calendar?.calendarIdentifier ?? "",
        ]
        if let c = r.dueDateComponents, let y = c.year, let m = c.month, let day = c.day {
            d["dueDate"] = String(format: "%04d-%02d-%02d", y, m, day)
            if let h = c.hour, let mi = c.minute { d["dueTime"] = String(format: "%02d:%02d", h, mi) }
        }
        return d
    }

    func reminderCalendars(_ name: Any?) -> [EKCalendar]? {
        guard let n = name as? String, !n.isEmpty else { return nil }
        let hits = eventStore.calendars(for: .reminder).filter { $0.title.lowercased() == n.lowercased() || $0.calendarIdentifier == n }
        return hits.isEmpty ? nil : hits
    }

    func reminders(_ a: [String: Any], _ reply: @escaping BridgeReply) {
        do {
            try needAccess(.reminder, "die Erinnerungen")
        } catch let f as BridgeFailure {
            reply(.failure(f))
            return
        } catch {
            reply(.failure(BridgeFailure(error.localizedDescription)))
            return
        }
        let cals = reminderCalendars(a["list"])
        let includeDone = (a["includeCompleted"] as? Bool) == true
        let pred = includeDone ? eventStore.predicateForReminders(in: cals) : eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: cals)
        eventStore.fetchReminders(matching: pred) { items in
            let list = (items ?? []).prefix(300).map { self.reminderDict($0) }
            reply(.success(["reminders": Array(list)]))
        }
    }

    func createReminder(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.reminder, "die Erinnerungen")
        let r = EKReminder(eventStore: eventStore)
        r.title = a["title"] as? String ?? ""
        if let notes = a["notes"] as? String, !notes.isEmpty { r.notes = notes }
        r.priority = (a["priority"] as? String) == "hoch" ? 1 : 0
        r.calendar = reminderCalendars(a["list"])?.first ?? eventStore.defaultCalendarForNewReminders()
        if let day = a["dueDate"] as? String {
            let parts = day.split(separator: "-").compactMap { Int($0) }
            if parts.count == 3 {
                var comps = DateComponents(calendar: Calendar.current, year: parts[0], month: parts[1], day: parts[2])
                if let time = a["dueTime"] as? String {
                    let hm = time.split(separator: ":").compactMap { Int($0) }
                    if hm.count == 2 {
                        comps.hour = hm[0]
                        comps.minute = hm[1]
                        if let when = Calendar.current.date(from: comps) { r.addAlarm(EKAlarm(absoluteDate: when)) }
                    }
                }
                r.dueDateComponents = comps
            }
        }
        try eventStore.save(r, commit: true)
        return reminderDict(r)
    }

    func findReminder(_ id: Any?) throws -> EKReminder {
        guard let id = id as? String, let r = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw BridgeFailure("Diese Erinnerung finde ich nicht mehr.", code: "notFound")
        }
        return r
    }

    func updateReminder(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.reminder, "die Erinnerungen")
        let r = try findReminder(a["id"])
        if let done = a["completed"] as? Bool { r.isCompleted = done }
        if let t = a["title"] as? String { r.title = t }
        try eventStore.save(r, commit: true)
        return reminderDict(r)
    }

    func deleteReminder(_ a: [String: Any]) throws -> [String: Any] {
        try needAccess(.reminder, "die Erinnerungen")
        try eventStore.remove(try findReminder(a["id"]), commit: true)
        return ["ok": true]
    }

    // MARK: - Kontakte

    func searchContacts(_ a: [String: Any]) throws -> [[String: Any]] {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: break
        case .notDetermined: throw BridgeFailure("Kontakte sind noch nicht erlaubt.", code: "unknown")
        default: throw BridgeFailure("Kein Zugriff auf die Kontakte.", code: "denied")
        }
        let query = a["query"] as? String ?? ""
        let limit = (a["limit"] as? Int) ?? 8
        let keys: [CNKeyDescriptor] = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
        ]
        let found = try contactStore.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: keys)
        return found.prefix(limit).map { c in
            var d: [String: Any] = [
                "id": c.identifier,
                "name": CNContactFormatter.string(from: c, style: .fullName) ?? c.organizationName,
                "phones": c.phoneNumbers.map { ["label": CNLabeledValue<NSString>.localizedString(forLabel: $0.label ?? ""), "value": $0.value.stringValue] },
                "emails": c.emailAddresses.map { ["label": CNLabeledValue<NSString>.localizedString(forLabel: $0.label ?? ""), "value": $0.value as String] },
            ]
            if let b = c.birthday, let m = b.month, let day = b.day {
                d["birthday"] = b.year != nil ? String(format: "%04d-%02d-%02d", b.year!, m, day) : String(format: "%02d-%02d", m, day)
            }
            return d
        }
    }

    // MARK: - WhatsApp

    var whatsappDatabase: String? {
        let candidates = [
            whatsappContainer + "/ChatStorage.sqlite",
            NSHomeDirectory() + "/Library/Containers/net.whatsapp.WhatsApp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) }
    }

    /// Einmal lesen versuchen – dabei fragt macOS ggf. „Darf Assistent auf Daten anderer Apps zugreifen?“
    func probeWhatsApp() -> String {
        guard whatsappInstalled || FileManager.default.fileExists(atPath: whatsappContainer) else { return "notInstalled" }
        do {
            _ = try whatsappQuery(["sql": "SELECT COUNT(*) AS n FROM ZWACHATSESSION", "params": []])
            return "granted"
        } catch let f as BridgeFailure {
            return f.code == "notInstalled" ? "notInstalled" : (UserDefaults.standard.string(forKey: "whatsappZugriff") ?? "denied")
        } catch {
            return "denied"
        }
    }

    private func openDatabase(_ path: String) -> (OpaquePointer?, Int32, Int32) {
        var db: OpaquePointer?
        errno = 0
        let rc = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil)
        let err = errno
        if rc != SQLITE_OK {
            sqlite3_close(db)
            return (nil, rc, err)
        }
        sqlite3_busy_timeout(db, 4000)
        return (db, rc, err)
    }

    /// Kopie der Datenbank (falls WhatsApp sie gerade sperrt)
    private func copyDatabase(_ path: String) -> String? {
        let dir = NSTemporaryDirectory() + "assistent-wa-\(UUID().uuidString)"
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: path + suffix) {
                try FileManager.default.copyItem(atPath: path + suffix, toPath: dir + "/ChatStorage.sqlite" + suffix)
            }
            return dir + "/ChatStorage.sqlite"
        } catch {
            try? FileManager.default.removeItem(atPath: dir)
            return nil
        }
    }

    func whatsappQuery(_ a: [String: Any]) throws -> [String: Any] {
        guard let path = whatsappDatabase else {
            throw BridgeFailure("Ich finde die WhatsApp-Daten nicht. Ist WhatsApp für den Mac installiert und angemeldet?", code: "notInstalled")
        }
        let sql = a["sql"] as? String ?? ""
        let params = a["params"] as? [Any] ?? []
        var (db, rc, err) = openDatabase(path)
        var tempCopy: String? = nil
        if db == nil {
            if err == EPERM || err == EACCES {
                UserDefaults.standard.set("denied", forKey: "whatsappZugriff")
                throw BridgeFailure("Ich darf die WhatsApp-Daten nicht lesen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit.", code: "denied")
            }
            if let copy = copyDatabase(path) {
                tempCopy = copy
                (db, rc, err) = openDatabase(copy)
            }
        }
        defer {
            if let copy = tempCopy { try? FileManager.default.removeItem(atPath: (copy as NSString).deletingLastPathComponent) }
        }
        guard let handle = db else {
            throw BridgeFailure("Die WhatsApp-Daten lassen sich gerade nicht öffnen (Fehler \(rc)).")
        }
        defer { sqlite3_close(handle) }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK, let st = stmt else {
            let msg = String(cString: sqlite3_errmsg(handle))
            if msg.contains("authorization") || msg.contains("permission") {
                UserDefaults.standard.set("denied", forKey: "whatsappZugriff")
            }
            throw BridgeFailure("WhatsApp-Daten: \(msg)")
        }
        defer { sqlite3_finalize(st) }
        guard sqlite3_stmt_readonly(st) != 0 else { throw BridgeFailure("Nur Lesen ist erlaubt.") }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            if let s = p as? String {
                sqlite3_bind_text(st, idx, s, -1, transient)
            } else if let n = p as? NSNumber {
                if CFNumberIsFloatType(n as CFNumber) {
                    sqlite3_bind_double(st, idx, n.doubleValue)
                } else {
                    sqlite3_bind_int64(st, idx, n.int64Value)
                }
            } else {
                sqlite3_bind_null(st, idx)
            }
        }
        let count = sqlite3_column_count(st)
        var columns: [String] = []
        for i in 0..<count { columns.append(String(cString: sqlite3_column_name(st, i))) }
        var rows: [[Any]] = []
        while sqlite3_step(st) == SQLITE_ROW && rows.count < 3000 {
            var row: [Any] = []
            for i in 0..<count {
                switch sqlite3_column_type(st, i) {
                case SQLITE_INTEGER: row.append(NSNumber(value: sqlite3_column_int64(st, i)))
                case SQLITE_FLOAT:
                    let v = sqlite3_column_double(st, i)
                    row.append(v.isFinite ? NSNumber(value: v) : NSNull())
                case SQLITE_TEXT:
                    if let c = sqlite3_column_text(st, i) { row.append(String(cString: c)) } else { row.append(NSNull()) }
                default: row.append(NSNull())
                }
            }
            rows.append(row)
        }
        UserDefaults.standard.set("granted", forKey: "whatsappZugriff")
        return ["columns": columns, "rows": rows]
    }

    /// WhatsApp mit dem Chat und dem Text öffnen – und (mit Bedienungshilfen) auf Senden drücken.
    func whatsappSend(_ a: [String: Any], _ reply: @escaping BridgeReply) {
        let phone = (a["phone"] as? String ?? "").filter { $0.isNumber }
        let text = a["text"] as? String ?? ""
        let autoSend = (a["autoSend"] as? Bool) == true
        var comps = URLComponents()
        comps.scheme = "whatsapp"
        comps.host = "send"
        comps.queryItems = [URLQueryItem(name: "phone", value: phone), URLQueryItem(name: "text", value: text)]
        guard !phone.isEmpty, let url = comps.url else {
            reply(.failure(BridgeFailure("Telefonnummer fehlt.")))
            return
        }
        DispatchQueue.main.async {
            let wasRunning = self.waBundleIDs.contains { !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty }
            if !NSWorkspace.shared.open(url) {
                var web = URLComponents(string: "https://wa.me/\(phone)")
                web?.queryItems = [URLQueryItem(name: "text", value: text)]
                if let w = web?.url { NSWorkspace.shared.open(w) }
                reply(.success(["opened": true, "pressed": false]))
                return
            }
            guard autoSend, AXIsProcessTrusted() else {
                reply(.success(["opened": true, "pressed": false]))
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + (wasRunning ? 2.0 : 5.0)) {
                guard let front = NSWorkspace.shared.frontmostApplication, self.waBundleIDs.contains(front.bundleIdentifier ?? "") else {
                    reply(.success(["opened": true, "pressed": false]))
                    return
                }
                let source = CGEventSource(stateID: .hidSystemState)
                let down = CGEvent(keyboardEventSource: source, virtualKey: 0x24, keyDown: true)
                let up = CGEvent(keyboardEventSource: source, virtualKey: 0x24, keyDown: false)
                down?.postToPid(front.processIdentifier)
                up?.postToPid(front.processIdentifier)
                reply(.success(["opened": true, "pressed": true]))
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
        }
    }

    func whatsappOpen(_ a: [String: Any], _ reply: @escaping BridgeReply) {
        let text = a["text"] as? String ?? ""
        DispatchQueue.main.async {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            if let url = URL(string: "whatsapp://") { NSWorkspace.shared.open(url) }
            reply(.success(["opened": true]))
        }
    }

    // MARK: - Mitteilungen

    func notify(_ a: [String: Any]) {
        let content = UNMutableNotificationContent()
        content.title = a["title"] as? String ?? "Assistent"
        content.body = a["body"] as? String ?? ""
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }
}
