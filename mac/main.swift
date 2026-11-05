// Assistent – Mac-App
//
// Zeigt das Dashboard in einem eigenen Fenster und startet den Assistenten selbst.
// Bringt mit: Sprechen und Vorlesen über macOS, Mitteilungen, Standort fürs Wetter,
// „Im Dock behalten“, morgens von selbst starten und „In Programme legen“.
//
// Zwei Arten, wie die App gebaut sein kann:
//  • Fertiges Paket (Download): Server und Node.js stecken in der App, Daten liegen in
//    ~/Library/Application Support/Assistent.
//  • Aus einem Ordner gebaut („Mac-App bauen.command“): Info.plist enthält „AssistentOrdner“,
//    der Server läuft aus diesem Ordner mit dem installierten Node.js, Daten in <Ordner>/data.

import Cocoa
import WebKit
import AVFoundation
import Speech
import UserNotifications
import CoreLocation
import ApplicationServices

final class AssistentApp: NSObject, NSApplicationDelegate, NSMenuItemValidation, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, AVSpeechSynthesizerDelegate,
    UNUserNotificationCenterDelegate, CLLocationManagerDelegate {

    // MARK: - Wo alles liegt

    let devFolder: String? = Bundle.main.object(forInfoDictionaryKey: "AssistentOrdner") as? String
    let port: Int = Int((Bundle.main.object(forInfoDictionaryKey: "AssistentPort") as? String) ?? "3000") ?? 3000
    let bundleID: String = Bundle.main.bundleIdentifier ?? "de.assistent-agent.mac"
    let startedInBackground: Bool = CommandLine.arguments.contains("--hintergrund")

    var baseURL: URL { return URL(string: "http://localhost:\(port)/")! }
    var serverFolder: String { return devFolder ?? ((Bundle.main.resourcePath ?? "") + "/server") }
    var dataDir: String {
        if let folder = devFolder { return folder + "/data" }
        return NSHomeDirectory() + "/Library/Application Support/Assistent"
    }
    var logPath: String { return dataDir + "/assistent.log" }
    var launchAgentPath: String { return NSHomeDirectory() + "/Library/LaunchAgents/de.assistent-agent.plist" }
    var backgroundInstalled: Bool { return FileManager.default.fileExists(atPath: launchAgentPath) }
    var bundlePath: String { return Bundle.main.bundleURL.standardizedFileURL.path }
    /// Läuft die App von einem Ort, an dem sie nicht bleiben kann (Disk-Image, Downloads-Kopie von macOS)?
    var runsFromTemporaryPlace: Bool { return bundlePath.hasPrefix("/Volumes/") || bundlePath.contains("/AppTranslocation/") }

    var window: NSWindow!
    var webView: WKWebView!
    var statusItem: NSStatusItem?
    var server: Process?
    var serverLog: FileHandle?
    var loadFailures = 0
    var planTimer: Timer?
    var leaving = false
    var bridge: MacBridge?

    // Vorlesen
    let synthesizer = AVSpeechSynthesizer()
    var utteranceIds: [ObjectIdentifier: String] = [:]

    // Zuhören
    let audioEngine = AVAudioEngine()
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))
    var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var recognitionTask: SFSpeechRecognitionTask?
    var tapInstalled = false
    var listenId: String?
    var listenText = ""
    var listenFinished = true
    var silenceTimer: Timer?
    var listenTimeout: Timer?

    // Standort
    var locationManager: CLLocationManager?
    var locationReplyIds: [String] = []
    var locationTimeout: Timer?

    // MARK: - Start und Ende

    func applicationDidFinishLaunching(_ notification: Notification) {
        if handOverToRunningInstance() { return }
        if offerMoveToApplications() { return }
        synthesizer.delegate = self
        UNUserNotificationCenter.current().delegate = self
        buildMenu()
        buildWindow()
        updateStatusItem()
        if !startedInBackground { showWindow() }
        showMessage(title: "Assistent startet …", text: "Einen Moment.", showRetry: false)
        startServer()
        startPlanWatcher()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Mit „Morgens von selbst starten“ läuft der Assistent weiter, wenn das Fenster zu ist
        return !backgroundInstalled
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        if !leaving, let window = window, !window.isVisible { showWindow() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        bridge?.stop()
        synthesizer.stopSpeaking(at: .immediate)
        stopListening(cancel: true)
        stopOwnServer()
    }

    /// Läuft die App schon (z. B. im Hintergrund)? Dann die laufende nach vorne holen und selbst gehen.
    func handOverToRunningInstance() -> Bool {
        let me = ProcessInfo.processInfo.processIdentifier
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).filter { $0.processIdentifier != me }
        guard let other = others.first else { return false }
        leaving = true
        if !startedInBackground {
            if #available(macOS 14.0, *) {
                other.activate()
            } else {
                other.activate(options: [.activateIgnoringOtherApps])
            }
        }
        DispatchQueue.main.async { NSApp.terminate(nil) }
        return true
    }

    func stopOwnServer() {
        guard let p = server else { return }
        server = nil
        if p.isRunning {
            p.terminate()
            let deadline = Date().addingTimeInterval(3)
            while p.isRunning && Date() < deadline { usleep(50_000) }
        }
    }

    // MARK: - In den Programme-Ordner legen

    func isInApplications() -> Bool {
        return bundlePath.hasPrefix("/Applications/") || bundlePath.hasPrefix(NSHomeDirectory() + "/Applications/")
    }

    /// Wurde die App direkt aus dem Download geöffnet, bietet sie an, sich selbst nach „Programme“ zu legen.
    func offerMoveToApplications() -> Bool {
        guard devFolder == nil, !startedInBackground, !isInApplications() else { return false }
        if UserDefaults.standard.bool(forKey: "nichtVerschieben") { return false }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Soll ich „Assistent“ in deinen Programme-Ordner legen?"
        alert.informativeText = "Dann findest du die App im Launchpad, kannst sie im Dock behalten, und sie kann morgens von selbst starten."
        alert.addButton(withTitle: "In Programme legen")
        alert.addButton(withTitle: "Nicht jetzt")
        guard alert.runModal() == .alertFirstButtonReturn else {
            UserDefaults.standard.set(true, forKey: "nichtVerschieben")
            return false
        }
        let fm = FileManager.default
        let target = URL(fileURLWithPath: "/Applications/Assistent.app")
        do {
            if fm.fileExists(atPath: target.path) {
                for other in NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
                    where other.bundleURL?.standardizedFileURL.path == target.path {
                    other.terminate()
                }
                try fm.trashItem(at: target, resultingItemURL: nil)
            }
            try fm.copyItem(at: Bundle.main.bundleURL, to: target)
        } catch {
            let fail = NSAlert()
            fail.messageText = "Das hat nicht geklappt"
            fail.informativeText = "Zieh „Assistent“ bitte selbst im Finder in den Ordner „Programme“ und öffne die App von dort.\n\n(\(error.localizedDescription))"
            fail.runModal()
            return false
        }
        // Die Kopie hast du gerade selbst erlaubt – macOS soll nicht noch einmal fragen
        run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", target.path])
        var script = "sleep 1; /usr/bin/open \"\(target.path)\""
        if bundlePath.hasPrefix("/Volumes/") {
            let parts = bundlePath.split(separator: "/")
            if parts.count >= 2 { script += "; sleep 2; /usr/bin/hdiutil detach -quiet \"/Volumes/\(parts[1])\" || true" }
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", script]
        try? p.run()
        leaving = true
        DispatchQueue.main.async { NSApp.terminate(nil) }
        return true
    }

    // MARK: - Fenster

    func buildWindow() {
        let controller = WKUserContentController()
        controller.add(self, name: "assistentNative")
        controller.addUserScript(WKUserScript(source: "window.__assistentApp = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .black }
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Assistent"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .black
        window.minSize = NSSize(width: 420, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("AssistentFenster")
    }

    func showWindow() {
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        synthesizer.stopSpeaking(at: .immediate)
        stopListening(cancel: true)
        if backgroundInstalled {
            // Weiterlaufen, aber ohne Symbol im Dock – erreichbar über den Punkt in der Menüleiste
            DispatchQueue.main.async { NSApp.setActivationPolicy(.accessory) }
        }
    }

    func showMessage(title: String, text: String, showRetry: Bool, link: (String, String)? = nil) {
        func esc(_ s: String) -> String {
            return s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        var buttons = ""
        if let link = link { buttons += "<a class=\"btn\" href=\"\(link.1)\">\(esc(link.0))</a>" }
        if showRetry { buttons += "<a class=\"btn quiet\" href=\"assistent://retry\">Nochmal versuchen</a>" }
        let html = """
        <!doctype html><html lang="de"><head><meta charset="utf-8"><style>
        body{margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#f4f1ec;font:16px -apple-system,system-ui,sans-serif}
        main{max-width:480px;padding:24px;text-align:center}
        .orb{width:72px;height:72px;border-radius:50%;margin:0 auto 24px;background:radial-gradient(circle at 34% 30%,#ffd0a6,#ff9a4f 18%,#ff6b1a 50%,#7a2600);box-shadow:0 0 44px rgba(255,107,26,.5);animation:p 1.6s ease-in-out infinite alternate}
        @keyframes p{to{box-shadow:0 0 70px rgba(255,107,26,.75);transform:scale(1.04)}}
        h1{font-size:24px;margin:0 0 10px}
        p{color:#a8a39c;line-height:1.5;margin:0 0 22px}
        .btn{display:inline-block;margin:4px;padding:10px 18px;border-radius:999px;background:#ff6b1a;color:#140700;font-weight:600;text-decoration:none}
        .quiet{background:#1b1b1b;color:#f4f1ec;border:1px solid #333}
        </style></head><body><main><div class="orb"></div><h1>\(esc(title))</h1><p>\(esc(text))</p>\(buttons)</main></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Den Assistenten (Node.js) starten

    func startServer() {
        checkHealth { ok in
            if ok {
                self.loadDashboard()
                return
            }
            guard FileManager.default.fileExists(atPath: self.serverFolder + "/server.js") else {
                self.showMessage(title: "Assistent nicht gefunden",
                                 text: self.devFolder != nil
                                    ? "Ich finde den Assistenten nicht unter \(self.serverFolder). Hast du den Ordner verschoben? Dann dort noch einmal „Mac-App bauen.command“ öffnen."
                                    : "Die App ist unvollständig. Lade sie bitte noch einmal herunter.",
                                 showRetry: true)
                return
            }
            guard let node = self.findNode() else {
                self.showMessage(title: "Node.js fehlt",
                                 text: "Der Assistent braucht Node.js. Lade die LTS-Version herunter, installiere sie und tippe dann auf „Nochmal versuchen“.",
                                 showRetry: true, link: ("Node.js herunterladen", "https://nodejs.org/de/download"))
                return
            }
            if self.server?.isRunning != true {
                do {
                    try self.launch(node: node)
                } catch {
                    self.showMessage(title: "Start hat nicht geklappt", text: error.localizedDescription, showRetry: true)
                    return
                }
            }
            self.waitForServer(attempts: 80)
        }
    }

    func prepareDataDir() {
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }

    /// Geheimer Schlüssel, mit dem sich die App ohne Passwort beim Assistenten anmeldet
    func appKey() -> String {
        prepareDataDir()
        let path = dataDir + "/app-schluessel"
        if let existing = try? String(contentsOfFile: path, encoding: .utf8) {
            let key = existing.trimmingCharacters(in: .whitespacesAndNewlines)
            if key.count >= 32 { return key }
        }
        let key = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
        FileManager.default.createFile(atPath: path, contents: Data(key.utf8), attributes: [.posixPermissions: 0o600])
        return key
    }

    func launch(node: String) throws {
        prepareDataDir()
        _ = appKey()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [serverFolder + "/server.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: serverFolder)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        env["PORT"] = String(port)
        env["DATA_DIR"] = dataDir
        p.environment = env
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        if let handle = FileHandle(forWritingAtPath: logPath) {
            handle.seekToEndOfFile()
            p.standardOutput = handle
            p.standardError = handle
            serverLog = handle
        }
        try p.run()
        server = p
    }

    func waitForServer(attempts: Int) {
        checkHealth { ok in
            if ok {
                self.loadDashboard()
                return
            }
            let died = self.server != nil && self.server?.isRunning == false
            if attempts <= 0 || died {
                self.showMessage(title: "Der Assistent startet nicht",
                                 text: "Vielleicht ist Port \(self.port) schon von einem anderen Programm belegt. Details stehen in der Datei „assistent.log“ im Datenordner (Menü Assistent → Datenordner im Finder zeigen).",
                                 showRetry: true)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.waitForServer(attempts: attempts - 1) }
        }
    }

    func checkHealth(_ done: @escaping (Bool) -> Void) {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/health"))
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    func findNode() -> String? {
        // 1. Mitgeliefertes Node.js im fertigen Paket
        if devFolder == nil {
            #if arch(arm64)
            let name = "node-arm64"
            #else
            let name = "node-x64"
            #endif
            let bundled = Bundle.main.bundlePath + "/Contents/Helpers/" + name
            if FileManager.default.isExecutableFile(atPath: bundled) {
                _ = removexattr(bundled, "com.apple.quarantine", 0)
                return bundled
            }
        }
        // 2. Installiertes Node.js
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        let nvm = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            for v in versions.sorted(by: >) { candidates.append(nvm + "/" + v + "/bin/node") }
        }
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return c
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            p.waitUntilExit()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty || !FileManager.default.isExecutableFile(atPath: path) { return nil }
        return path
    }

    func loadDashboard() {
        startBridge()
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/app-login"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "key", value: appKey())]
        webView.load(URLRequest(url: comps.url!))
    }

    /// Verbindung zum Assistenten: Kalender, Kontakte, WhatsApp, Apple Intelligence …
    func startBridge() {
        guard bridge == nil, let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        let b = MacBridge(baseURL: url, key: appKey())
        bridge = b
        b.start()
    }

    func openRoute(_ route: String) {
        showWindow()
        if webView.url?.host == "localhost" {
            webView.evaluateJavaScript("location.hash = '#\(route)'", completionHandler: nil)
        }
    }

    // MARK: - Tagesplan melden

    func startPlanWatcher() {
        planTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            self?.checkPlan()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.checkPlan() }
    }

    func checkPlan() {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/status"))
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let json = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any],
                  let planDate = json["planDate"] as? String else { return }
            DispatchQueue.main.async { self.planReady(planDate) }
        }.resume()
    }

    func planReady(_ date: String) {
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: "gemeldeterTagesplan")
        guard last != date else { return }
        defaults.set(date, forKey: "gemeldeterTagesplan")
        guard last != nil else { return } // beim allerersten Plan nichts melden – den siehst du gerade
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard date == formatter.string(from: Date()) else { return }
        if NSApp.isActive && window.isVisible { return }
        notify(title: "Guten Morgen! Dein Tagesplan ist fertig.", body: "Klick hier, dann siehst du deine To-dos für heute.")
    }

    func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.showWindow()
            self.loadDashboard()
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // MARK: - Menüleiste (nur wenn der Assistent im Hintergrund läuft)

    func updateStatusItem() {
        if backgroundInstalled {
            guard statusItem == nil else { return }
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            item.button?.image = orbImage(size: 18)
            item.button?.toolTip = "Assistent"
            let menu = NSMenu()
            let open = NSMenuItem(title: "Assistent öffnen", action: #selector(openFromStatusItem(_:)), keyEquivalent: "")
            open.target = self
            menu.addItem(open)
            let today = NSMenuItem(title: "Berechtigungen …", action: #selector(openPermissions(_:)), keyEquivalent: "")
            today.target = self
            menu.addItem(today)
            menu.addItem(NSMenuItem.separator())
            menu.addItem(NSMenuItem(title: "Beenden (bis zum nächsten Anmelden)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
            item.menu = menu
            statusItem = item
        } else if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func orbImage(size: CGFloat) -> NSImage {
        return NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            let dot = rect.insetBy(dx: rect.width * 0.22, dy: rect.height * 0.22)
            NSColor(srgbRed: 1.0, green: 0.42, blue: 0.1, alpha: 0.3).setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: rect.width * 0.1, dy: rect.height * 0.1)).fill()
            NSColor(srgbRed: 1.0, green: 0.42, blue: 0.1, alpha: 1).setFill()
            NSBezierPath(ovalIn: dot).fill()
            return true
        }
    }

    @objc func openFromStatusItem(_ sender: Any?) {
        showWindow()
    }

    // MARK: - Menüs

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: "Assistent")
        appMenu.addItem(withTitle: "Über Assistent", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let settings = NSMenuItem(title: "Einstellungen …", action: #selector(openSettingsPage(_:)), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(settings)
        let permissions = NSMenuItem(title: "Berechtigungen …", action: #selector(openPermissions(_:)), keyEquivalent: "")
        permissions.target = self
        appMenu.addItem(permissions)
        appMenu.addItem(NSMenuItem.separator())
        let background = NSMenuItem(title: "Morgens von selbst starten", action: #selector(toggleBackground(_:)), keyEquivalent: "")
        background.target = self
        appMenu.addItem(background)
        let dock = NSMenuItem(title: "Im Dock behalten", action: #selector(keepInDock(_:)), keyEquivalent: "")
        dock.target = self
        appMenu.addItem(dock)
        appMenu.addItem(NSMenuItem.separator())
        let browser = NSMenuItem(title: "In Safari öffnen", action: #selector(openInBrowser(_:)), keyEquivalent: "")
        browser.target = self
        appMenu.addItem(browser)
        let finder = NSMenuItem(title: "Datenordner im Finder zeigen", action: #selector(showFolder(_:)), keyEquivalent: "")
        finder.target = self
        appMenu.addItem(finder)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Assistent ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Assistent beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Ohne dieses Menü funktionieren ⌘C und ⌘V in Textfeldern nicht
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Bearbeiten")
        edit.addItem(withTitle: "Widerrufen", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Wiederholen", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(NSMenuItem.separator())
        edit.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Einsetzen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "Darstellung")
        let reload = NSMenuItem(title: "Neu laden", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        reload.target = self
        view.addItem(reload)
        let full = view.addItem(withTitle: "Vollbild", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Fenster")
        windowMenu.addItem(withTitle: "Minimieren", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Schließen", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(toggleBackground(_:)) {
            menuItem.state = backgroundInstalled ? .on : .off
        }
        if menuItem.action == #selector(keepInDock(_:)) {
            menuItem.state = isInDock() ? .on : .off
        }
        return true
    }

    @objc func reloadPage(_ sender: Any?) {
        loadFailures = 0
        if webView.url?.host == "localhost" { webView.reload() } else { startServer() }
    }

    @objc func openSettingsPage(_ sender: Any?) {
        openRoute("/einstellungen")
    }

    @objc func openPermissions(_ sender: Any?) {
        openRoute("/berechtigungen")
    }

    @objc func openInBrowser(_ sender: Any?) {
        NSWorkspace.shared.open(baseURL)
    }

    @objc func showFolder(_ sender: Any?) {
        prepareDataDir()
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: dataDir)])
    }

    @objc func toggleBackground(_ sender: Any?) {
        let turnOn = !backgroundInstalled
        let ok = setBackground(turnOn)
        let alert = NSAlert()
        if ok {
            alert.messageText = turnOn ? "Startet ab jetzt von selbst" : "Startet nicht mehr von selbst"
            alert.informativeText = turnOn
                ? "Der Assistent startet nach jedem Anmelden leise im Hintergrund – so ist dein Tagesplan morgens fertig. Schließt du das Fenster, läuft er weiter; oben in der Menüleiste siehst du ihn als orangen Punkt."
                : "Der Assistent läuft jetzt nur noch, solange diese App offen ist."
        } else {
            alert.messageText = "Das geht erst im Programme-Ordner"
            alert.informativeText = "Leg „Assistent“ bitte zuerst in den Ordner „Programme“ und öffne die App von dort."
        }
        alert.beginSheetModal(for: window) { _ in }
    }

    @objc func keepInDock(_ sender: Any?) {
        if isInDock() { return }
        if !addToDock() {
            let alert = NSAlert()
            alert.messageText = "Das geht erst im Programme-Ordner"
            alert.informativeText = "Leg „Assistent“ bitte zuerst in den Ordner „Programme“ und öffne die App von dort."
            alert.beginSheetModal(for: window) { _ in }
        }
    }

    // MARK: - Dock und Hintergrund

    func dockApps() -> [[String: Any]] {
        CFPreferencesAppSynchronize("com.apple.dock" as CFString)
        return (CFPreferencesCopyAppValue("persistent-apps" as CFString, "com.apple.dock" as CFString) as? [[String: Any]]) ?? []
    }

    func isInDock() -> Bool {
        let mine = bundlePath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        for app in dockApps() {
            guard let tile = app["tile-data"] as? [String: Any] else { continue }
            if (tile["bundle-identifier"] as? String) == bundleID { return true }
            if let file = tile["file-data"] as? [String: Any], let raw = file["_CFURLString"] as? String {
                let path = raw.hasPrefix("file://") ? (URL(string: raw)?.standardizedFileURL.path ?? raw) : raw
                if path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == mine { return true }
            }
        }
        return false
    }

    func addToDock() -> Bool {
        if isInDock() { return true }
        guard !runsFromTemporaryPlace else { return false }
        let path = bundlePath.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        let entry = "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>\(path)</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
        guard run("/usr/bin/defaults", ["write", "com.apple.dock", "persistent-apps", "-array-add", entry]) == 0 else { return false }
        run("/usr/bin/killall", ["Dock"])
        return true
    }

    /// Hintergrund an: macOS startet die App nach jedem Anmelden unsichtbar (LaunchAgent).
    /// Wirkt ab dem nächsten Anmelden – bis dahin läuft diese App einfach weiter, wenn das Fenster zu ist.
    func setBackground(_ on: Bool) -> Bool {
        let fm = FileManager.default
        if !on {
            try? fm.removeItem(atPath: launchAgentPath)
            updateStatusItem()
            return true
        }
        guard let exe = Bundle.main.executablePath, !runsFromTemporaryPlace else { return false }
        let plist: [String: Any] = [
            "Label": "de.assistent-agent",
            "ProgramArguments": [exe, "--hintergrund"],
            "RunAtLoad": true,
            "KeepAlive": ["SuccessfulExit": false],
            "LimitLoadToSessionType": "Aqua",
            "ProcessType": "Interactive",
        ]
        do {
            try fm.createDirectory(atPath: (launchAgentPath as NSString).deletingLastPathComponent, withIntermediateDirectories: true, attributes: nil)
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try data.write(to: URL(fileURLWithPath: launchAgentPath), options: .atomic)
        } catch {
            return false
        }
        updateStatusItem()
        return true
    }

    @discardableResult
    func run(_ tool: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
        } catch {
            return -1
        }
        p.waitUntilExit()
        return p.terminationStatus
    }

    // MARK: - Berechtigungen

    func permissionStatuses(_ done: @escaping ([String: String]) -> Void) {
        var st: [String: String] = [:]
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: st["microphone"] = "granted"
        case .notDetermined: st["microphone"] = "unknown"
        default: st["microphone"] = "denied"
        }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: st["speech"] = "granted"
        case .notDetermined: st["speech"] = "unknown"
        default: st["speech"] = "denied"
        }
        st["location"] = locationStatus()
        st["dock"] = isInDock() ? "granted" : "unknown"
        st["background"] = backgroundInstalled ? "granted" : "unknown"
        st["applications"] = isInApplications() ? "granted" : "unknown"
        let base = st
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            var result = base
            switch settings.authorizationStatus {
            case .authorized, .provisional: result["notifications"] = "granted"
            case .notDetermined: result["notifications"] = "unknown"
            default: result["notifications"] = "denied"
            }
            DispatchQueue.main.async { done(result) }
        }
    }

    func requestPermission(kind: String, id: String) {
        let reply: (String) -> Void = { status in
            DispatchQueue.main.async {
                self.send(["id": id, "type": "permission", "kind": kind, "status": status])
            }
        }
        switch kind {
        case "microphone":
            AVCaptureDevice.requestAccess(for: .audio) { ok in reply(ok ? "granted" : "denied") }
        case "speech":
            SFSpeechRecognizer.requestAuthorization { status in reply(status == .authorized ? "granted" : "denied") }
        case "notifications":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
                reply(ok ? "granted" : "denied")
            }
        case "location":
            requestLocation(id: id)
        case "dock":
            reply(addToDock() ? "granted" : "unknown")
        case "background":
            reply(setBackground(true) ? "granted" : "unknown")
        case "accessibility":
            let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            reply(AXIsProcessTrustedWithOptions(opts) ? "granted" : "denied")
            openPrivacySettings("accessibility")
        default:
            reply("unavailable")
        }
    }

    func openPrivacySettings(_ kind: String) {
        let anchors = [
            "microphone": "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "speech": "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
            "location": "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
            "notifications": "x-apple.systempreferences:com.apple.preference.notifications",
            "calendar": "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
            "reminders": "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
            "contacts": "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
            "automation": "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
            "accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "appdata": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            "privacy": "x-apple.systempreferences:com.apple.preference.security?Privacy",
        ]
        if let s = anchors[kind], let url = URL(string: s) { NSWorkspace.shared.open(url) }
    }

    // MARK: - Standort (fürs Wetter)

    func locationStatus() -> String {
        let manager = locationManager ?? CLLocationManager()
        switch manager.authorizationStatus {
        case .notDetermined: return "unknown"
        case .denied, .restricted: return "denied"
        default: return "granted"
        }
    }

    func requestLocation(id: String) {
        let manager = locationManager ?? CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        locationManager = manager
        locationReplyIds.append(id)
        locationTimeout?.invalidate()
        locationTimeout = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.finishLocation(["status": self.locationStatus(), "error": "Ich konnte deinen Ort gerade nicht bestimmen. Du kannst ihn auch beim Schritt „Wetter“ eintippen."])
        }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: finishLocation(["status": "denied"])
        default: manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !locationReplyIds.isEmpty else { return }
        switch manager.authorizationStatus {
        case .notDetermined: break
        case .denied, .restricted: finishLocation(["status": "denied"])
        default: manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, !locationReplyIds.isEmpty else { return }
        CLGeocoder().reverseGeocodeLocation(location, preferredLocale: Locale(identifier: "de_DE")) { placemarks, _ in
            DispatchQueue.main.async {
                let place = placemarks?.first
                let name = place?.locality ?? place?.subAdministrativeArea ?? place?.name ?? "Mein Standort"
                let region = [place?.administrativeArea, place?.country].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
                self.finishLocation([
                    "status": "granted",
                    "latitude": (location.coordinate.latitude * 1000).rounded() / 1000,
                    "longitude": (location.coordinate.longitude * 1000).rounded() / 1000,
                    "name": name,
                    "region": region,
                ])
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard !locationReplyIds.isEmpty else { return }
        if let clError = error as? CLError, clError.code == .locationUnknown { return } // es kommt noch was
        finishLocation(["status": locationStatus(), "error": "Ich konnte deinen Ort gerade nicht bestimmen. Du kannst ihn auch beim Schritt „Wetter“ eintippen."])
    }

    func finishLocation(_ result: [String: Any]) {
        locationTimeout?.invalidate()
        locationTimeout = nil
        let ids = locationReplyIds
        locationReplyIds = []
        for id in ids {
            var r = result
            r["id"] = id
            r["type"] = "permission"
            r["kind"] = "location"
            send(r)
        }
    }

    // MARK: - Webseite: Links, Dialoge, Fehler

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "assistent" {
            if url.host == "retry" {
                loadFailures = 0
                startServer()
            }
            decisionHandler(.cancel)
            return
        }
        let host = url.host ?? ""
        let isLocal = host == "localhost" || host == "127.0.0.1" || host == "::1"
        if url.scheme == "mailto" || url.scheme == "x-apple.systempreferences" || ((url.scheme == "http" || url.scheme == "https") && !isLocal) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Abbrechen")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailures += 1
        if loadFailures > 3 {
            showMessage(title: "Keine Verbindung zum Assistenten", text: error.localizedDescription, showRetry: true)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.startServer() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url?.host == "localhost" { loadFailures = 0 }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: - Brücke zur Webseite

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let id = (body["id"] as? String) ?? ""
        switch cmd {
        case "speak":
            speak(id: id,
                  text: (body["text"] as? String) ?? "",
                  rate: (body["rate"] as? Double) ?? 0.92,
                  pitch: (body["pitch"] as? Double) ?? 0.8,
                  voice: body["voice"] as? String)
        case "stopSpeaking":
            synthesizer.stopSpeaking(at: .immediate)
        case "voices":
            send(["id": id, "type": "voices", "voices": voiceList()])
        case "listen":
            startListening(id: id)
        case "stopListening":
            stopListening(cancel: (body["cancel"] as? Bool) ?? false)
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString((body["text"] as? String) ?? "", forType: .string)
            send(["id": id, "type": "copied"])
        case "permissions":
            permissionStatuses { st in self.send(["id": id, "type": "permissions", "status": st]) }
        case "requestPermission":
            requestPermission(kind: (body["kind"] as? String) ?? "", id: id)
        case "setBackground":
            let ok = setBackground((body["on"] as? Bool) ?? false)
            send(["id": id, "type": "background", "ok": ok, "on": backgroundInstalled])
        case "openSettings":
            openPrivacySettings((body["kind"] as? String) ?? "")
            send(["id": id, "type": "ok"])
        case "showDataFolder":
            showFolder(nil)
            send(["id": id, "type": "ok"])
        case "appInfo":
            send(["id": id, "type": "appInfo",
                  "version": (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "",
                  "inApplications": isInApplications(), "background": backgroundInstalled, "dock": isInDock(), "dataDir": dataDir])
        default:
            break
        }
    }

    func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__assistentNative && window.__assistentNative.receive(\(json))", completionHandler: nil)
    }

    // MARK: - Vorlesen

    func score(_ v: AVSpeechSynthesisVoice) -> Int {
        var s = 0
        if v.quality == .enhanced { s += 30 }
        if #available(macOS 13.0, *) {
            if v.quality == .premium { s += 40 }
        }
        if v.gender == .male { s += 40 }
        let novelty = ["Grandma", "Grandpa", "Shelley", "Sandy", "Flo", "Eddy", "Reed", "Rocko", "Albert", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Bad News", "Good News"]
        if novelty.contains(where: { v.name.contains($0) }) { s -= 60 }
        if v.language == "de-DE" { s += 3 }
        return s
    }

    func germanVoices() -> [AVSpeechSynthesisVoice] {
        return AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("de") }.sorted { score($0) > score($1) }
    }

    func voiceList() -> [[String: Any]] {
        return germanVoices().map { (v: AVSpeechSynthesisVoice) -> [String: Any] in
            var quality = "standard"
            if v.quality == .enhanced { quality = "erweitert" }
            if #available(macOS 13.0, *) {
                if v.quality == .premium { quality = "premium" }
            }
            return ["id": v.identifier, "name": v.name, "lang": v.language, "quality": quality, "male": v.gender == .male, "score": score(v)]
        }
    }

    func speak(id: String, text: String, rate: Double, pitch: Double, voice: String?) {
        let utterance = AVSpeechUtterance(string: text)
        if let identifier = voice, !identifier.isEmpty, let chosen = AVSpeechSynthesisVoice(identifier: identifier) {
            utterance.voice = chosen
        } else {
            utterance.voice = germanVoices().first ?? AVSpeechSynthesisVoice(language: "de-DE")
        }
        utterance.rate = Float(Double(AVSpeechUtteranceDefaultSpeechRate) * max(0.5, min(1.6, rate)))
        utterance.pitchMultiplier = Float(max(0.5, min(2.0, pitch)))
        utteranceIds[ObjectIdentifier(utterance)] = id
        synthesizer.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finishUtterance(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finishUtterance(utterance)
    }

    func finishUtterance(_ utterance: AVSpeechUtterance) {
        let key = ObjectIdentifier(utterance)
        DispatchQueue.main.async {
            guard let id = self.utteranceIds.removeValue(forKey: key) else { return }
            self.send(["id": id, "type": "speech-end"])
        }
    }

    // MARK: - Zuhören

    func startListening(id: String) {
        stopListening(cancel: true)
        listenId = id
        AVCaptureDevice.requestAccess(for: .audio) { micAllowed in
            DispatchQueue.main.async {
                guard self.listenId == id else { return }
                guard micAllowed else {
                    self.listenError(id, "Kein Zugriff aufs Mikrofon. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon.", "denied")
                    return
                }
                SFSpeechRecognizer.requestAuthorization { status in
                    DispatchQueue.main.async {
                        guard self.listenId == id else { return }
                        guard status == .authorized else {
                            self.listenError(id, "Keine Erlaubnis für die Spracherkennung. Erlaube sie unter Systemeinstellungen → Datenschutz & Sicherheit → Spracherkennung.", "denied")
                            return
                        }
                        self.beginRecognition(id: id)
                    }
                }
            }
        }
    }

    func beginRecognition(id: String) {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            listenError(id, "Die Spracherkennung ist gerade nicht verfügbar. Bist du online?", "unavailable")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if #available(macOS 13.0, *) { request.addsPunctuation = true }
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            listenError(id, "Ich finde kein Mikrofon.", "no-mic")
            return
        }
        if tapInstalled { input.removeTap(onBus: 0) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapInstalled = true
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            input.removeTap(onBus: 0)
            tapInstalled = false
            listenError(id, "Das Mikrofon konnte nicht starten.", "audio")
            return
        }
        recognitionRequest = request
        listenText = ""
        listenFinished = false
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            DispatchQueue.main.async {
                guard let self = self, self.listenId == id, !self.listenFinished else { return }
                if let text = text {
                    self.listenText = text
                    self.send(["id": id, "type": "listen-text", "text": text, "final": isFinal])
                    if isFinal {
                        self.endListening(id: id)
                    } else {
                        self.armSilenceTimer(id: id)
                    }
                } else if failed {
                    if self.listenText.isEmpty {
                        self.send(["id": id, "type": "listen-error", "code": "no-speech", "message": "Ich habe nichts gehört."])
                    }
                    self.endListening(id: id)
                }
            }
        }
        // Sagt niemand etwas, nach ein paar Sekunden aufhören
        listenTimeout = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
            guard let self = self, self.listenId == id, self.listenText.isEmpty else { return }
            self.stopListening(cancel: false)
        }
        send(["id": id, "type": "listen-start"])
    }

    // Nach einer kurzen Pause ist der Satz fertig
    func armSilenceTimer(id: String) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { [weak self] _ in
            guard let self = self, self.listenId == id else { return }
            self.stopListening(cancel: false)
        }
    }

    func stopAudio() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        listenTimeout?.invalidate()
        listenTimeout = nil
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
    }

    func stopListening(cancel: Bool) {
        stopAudio()
        guard let id = listenId, !listenFinished else { return }
        if cancel {
            recognitionTask?.cancel()
            listenText = ""
            endListening(id: id)
        } else {
            recognitionRequest?.endAudio()
            // Falls kein Endergebnis mehr kommt
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                guard let self = self, self.listenId == id, !self.listenFinished else { return }
                self.endListening(id: id)
            }
        }
    }

    func endListening(id: String) {
        guard !listenFinished else { return }
        listenFinished = true
        stopAudio()
        recognitionRequest = nil
        recognitionTask = nil
        send(["id": id, "type": "listen-end", "text": listenText])
    }

    func listenError(_ id: String, _ message: String, _ code: String) {
        stopAudio()
        listenFinished = true
        send(["id": id, "type": "listen-error", "code": code, "message": message])
        send(["id": id, "type": "listen-end", "text": ""])
    }
}

let app = NSApplication.shared
let delegate = AssistentApp()
app.delegate = delegate
app.setActivationPolicy(CommandLine.arguments.contains("--hintergrund") ? .accessory : .regular)

// Beim Abmelden oder „kill“ sauber beenden, damit auch der Server mit stoppt
signal(SIGTERM, SIG_IGN)
let terminationSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminationSource.setEventHandler { NSApp.terminate(nil) }
terminationSource.resume()

app.run()
