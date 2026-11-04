// Assistent – Mac-App
// Zeigt das Dashboard in einem eigenen Fenster, startet den Assistenten selbst
// und bringt Sprechen und Vorlesen mit den Stimmen und der Spracherkennung von macOS.
//
// Gebaut wird sie mit „Mac-App bauen.command“ (braucht Xcode oder die Xcode-Befehlszeilenwerkzeuge).

import Cocoa
import WebKit
import AVFoundation
import Speech

final class AssistentApp: NSObject, NSApplicationDelegate, NSMenuItemValidation, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, AVSpeechSynthesizerDelegate {

    // MARK: - Einstellungen (schreibt das Bau-Skript in die Info.plist)

    let folder: String = (Bundle.main.object(forInfoDictionaryKey: "AssistentOrdner") as? String) ?? (NSHomeDirectory() + "/assistent-agent")
    let port: Int = Int((Bundle.main.object(forInfoDictionaryKey: "AssistentPort") as? String) ?? "3000") ?? 3000
    var baseURL: URL { return URL(string: "http://localhost:\(port)/")! }
    var launchAgentPath: String { return NSHomeDirectory() + "/Library/LaunchAgents/de.assistent-agent.plist" }
    var backgroundInstalled: Bool { return FileManager.default.fileExists(atPath: launchAgentPath) }

    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var serverLog: FileHandle?
    var loadFailures = 0

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

    // MARK: - Start und Ende

    func applicationDidFinishLaunching(_ notification: Notification) {
        synthesizer.delegate = self
        buildMenu()
        buildWindow()
        showMessage(title: "Assistent startet …", text: "Einen Moment.", showRetry: false)
        startServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        synthesizer.stopSpeaking(at: .immediate)
        stopListening(cancel: true)
        stopOwnServer()
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
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("AssistentFenster")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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
        .orb{width:72px;height:72px;border-radius:50%;margin:0 auto 24px;background:radial-gradient(circle at 34% 30%,#ff9b52,#ff6b1a 52%,#a83a00);box-shadow:0 0 40px rgba(255,107,26,.45)}
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
            guard FileManager.default.fileExists(atPath: self.folder + "/server.js") else {
                self.showMessage(title: "Ordner nicht gefunden",
                                 text: "Ich finde den Assistenten nicht unter \(self.folder). Hast du den Ordner verschoben? Dann doppelklicke im neuen Ordner noch einmal auf „Mac-App bauen.command“.",
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
            self.waitForServer(attempts: 60)
        }
    }

    func launch(node: String) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [folder + "/server.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: folder)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        env["PORT"] = String(port)
        p.environment = env
        let dataDir = folder + "/data"
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true, attributes: nil)
        let logPath = dataDir + "/assistent.log"
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil, attributes: nil)
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
                                 text: "Details stehen in der Datei data/assistent.log im Ordner \(self.folder). Vielleicht ist Port \(self.port) schon von einem anderen Programm belegt.",
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
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        let nvm = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            for v in versions.sorted(by: >) { candidates.append(nvm + "/" + v + "/bin/node") }
        }
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return c
        }
        // Zuletzt die Login-Shell fragen (z. B. bei eigener Installation)
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
        webView.load(URLRequest(url: baseURL))
    }

    // MARK: - Menüs

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: "Assistent")
        appMenu.addItem(withTitle: "Über Assistent", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let background = NSMenuItem(title: "Im Hintergrund laufen lassen", action: #selector(toggleBackground(_:)), keyEquivalent: "")
        background.target = self
        appMenu.addItem(background)
        let browser = NSMenuItem(title: "In Safari öffnen", action: #selector(openInBrowser(_:)), keyEquivalent: "")
        browser.target = self
        appMenu.addItem(browser)
        let finder = NSMenuItem(title: "Ordner im Finder zeigen", action: #selector(showFolder(_:)), keyEquivalent: "")
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
        return true
    }

    @objc func reloadPage(_ sender: Any?) {
        loadFailures = 0
        if webView.url?.host == "localhost" { webView.reload() } else { startServer() }
    }

    @objc func openInBrowser(_ sender: Any?) {
        NSWorkspace.shared.open(baseURL)
    }

    @objc func showFolder(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: folder)])
    }

    // Hintergrunddienst an/aus: Dann läuft der Assistent auch ohne geöffnete App,
    // und der Tagesplan kommt jeden Morgen.
    @objc func toggleBackground(_ sender: Any?) {
        let turnOn = !backgroundInstalled
        let script = folder + (turnOn ? "/scripts/autostart-an.sh" : "/scripts/autostart-aus.sh")
        if turnOn { stopOwnServer() }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [script]
        var env = ProcessInfo.processInfo.environment
        env["ASSISTENT_OHNE_FRAGEN"] = "1"
        env["ASSISTENT_KEIN_BROWSER"] = "1"
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        p.environment = env
        p.terminationHandler = { proc in
            let ok = proc.terminationStatus == 0
            DispatchQueue.main.async {
                let alert = NSAlert()
                if ok {
                    alert.messageText = turnOn ? "Läuft jetzt im Hintergrund" : "Hintergrund ist aus"
                    alert.informativeText = turnOn
                        ? "Der Assistent startet ab jetzt nach jedem Anmelden von selbst – auch wenn die App zu ist. So kommt dein Tagesplan jeden Morgen."
                        : "Der Assistent läuft jetzt nur noch, solange diese App offen ist."
                } else {
                    alert.messageText = "Das hat nicht geklappt"
                    alert.informativeText = "Details stehen in der Datei data/assistent.log."
                }
                alert.beginSheetModal(for: self.window) { _ in }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startServer() }
            }
        }
        do {
            try p.run()
        } catch {
            startServer()
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
        if url.scheme == "mailto" || ((url.scheme == "http" || url.scheme == "https") && !isLocal) {
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

    // MARK: - Brücke zur Webseite (Sprechen, Vorlesen, Zwischenablage)

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
        DispatchQueue.main.async {
            guard let id = self.utteranceIds.removeValue(forKey: ObjectIdentifier(utterance)) else { return }
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
            DispatchQueue.main.async {
                guard let self = self, self.listenId == id, !self.listenFinished else { return }
                if let result = result {
                    self.listenText = result.bestTranscription.formattedString
                    self.send(["id": id, "type": "listen-text", "text": self.listenText, "final": result.isFinal])
                    if result.isFinal {
                        self.endListening(id: id)
                    } else {
                        self.armSilenceTimer(id: id)
                    }
                } else if error != nil {
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
app.setActivationPolicy(.regular)
app.run()
