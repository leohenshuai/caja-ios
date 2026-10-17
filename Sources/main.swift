import UIKit
import WebKit
import AVFoundation
import AudioToolbox

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst()).removingPercentEncoding ?? "")
        guard file.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            task.didFinish(); return
        }
        let mimes = ["html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8",
                     "css": "text/css; charset=utf-8", "png": "image/png", "webmanifest": "application/manifest+json",
                     "json": "application/json", "svg": "image/svg+xml", "mp3": "audio/mpeg"]
        let mime = mimes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                   headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"])!
        task.didReceive(resp); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class VC: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var keepAwake = UserDefaults.standard.object(forKey: "keepAwake") as? Bool ?? true

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.067, blue: 0.125, alpha: 1)
        overrideUserInterfaceStyle = .dark
        let cfg = WKWebViewConfiguration()
        let www = Bundle.main.bundleURL.appendingPathComponent("www")
        cfg.setURLSchemeHandler(SchemeHandler(root: www), forURLScheme: "app")
        cfg.userContentController.add(self, name: "keepAwake")
        cfg.userContentController.add(self, name: "native")
        let js = "window.__NATIVE_KEEP_AWAKE__=\(keepAwake ? "true" : "false");"
        cfg.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.allowsInlineMediaPlayback = true
        let lang = Locale.preferredLanguages.first ?? "zh-Hans"
        cfg.userContentController.addUserScript(WKUserScript(source: "document.documentElement.lang='\(lang)';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.navigationDelegate = self
        web.uiDelegate = self
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.bounces = false
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        setupAudioSession()
        preloadVoices()
        apply()
        web.load(URLRequest(url: URL(string: "app://localhost/index.html")!))
        NotificationCenter.default.addObserver(self, selector: #selector(apply), name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    var lastCheck = Date.distantPast
    @objc func apply() {
        UIApplication.shared.isIdleTimerDisabled = keepAwake
        checkUpdate()
    }

    func checkUpdate(force: Bool = false, replyId: String? = nil) {
        if !force && Date().timeIntervalSince(lastCheck) < 600 { return }
        lastCheck = Date()
        guard let url = URL(string: "https://api.github.com/repos/leohenshuai/caja-ios/releases/latest") else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self else { return }
            guard let data = data,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = j["tag_name"] as? String,
                  let latest = Int(tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))) else {
                if let r = replyId { self.reply(r, ["ok": false, "error": "检查失败,请确认网络"]) }
                return }
            UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: "lastUpdateCheck")
            let cur = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
            let skipped = UserDefaults.standard.integer(forKey: "skipVersion")
            if let r = replyId { self.reply(r, ["ok": true, "latest": latest, "current": cur, "hasUpdate": latest > cur]) }
            guard latest > cur, force || latest != skipped else { return }
            var link = j["html_url"] as? String ?? ""
            if let assets = j["assets"] as? [[String: Any]],
               let a = assets.first(where: { ($0["name"] as? String ?? "").hasSuffix(".ipa") }),
               let u = a["browser_download_url"] as? String { link = u }
            let notes = (j["body"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async { self.promptUpdate(latest, cur, link, notes) }
        }.resume()
    }

    func promptUpdate(_ latest: Int, _ cur: Int, _ link: String, _ notes: String) {
        if presentedViewController != nil { return }
        let msg = "当前版本 \(cur),最新版本 \(latest)。\n下载后需要用 AltStore / Sideloadly 等工具重新签名安装。" + (notes.isEmpty ? "" : "\n\n" + notes)
        let a = UIAlertController(title: "发现新版本", message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "下载", style: .default) { _ in
            if let u = URL(string: link) { UIApplication.shared.open(u) }
        })
        a.addAction(UIAlertAction(title: "跳过此版本", style: .destructive) { _ in
            UserDefaults.standard.set(latest, forKey: "skipVersion")
        })
        a.addAction(UIAlertAction(title: "稍后", style: .cancel))
        present(a, animated: true)
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if m.name == "keepAwake", let b = m.body as? Bool {
            keepAwake = b
            UserDefaults.standard.set(b, forKey: "keepAwake")
            apply()
            return
        }
        guard m.name == "native", let d = m.body as? [String: Any],
              let id = d["id"] as? String, let op = d["op"] as? String else { return }
        let p = d["payload"] as? [String: Any] ?? [:]
        switch op {
        case "haptic": haptic(p["type"] as? String ?? "light"); reply(id, ["ok": true])
        case "sound": playKeySound(p["type"] as? String ?? "key"); reply(id, ["ok": true])
        case "speak": speak(p["text"] as? String ?? "", key: p["key"] as? String); reply(id, ["ok": true])
        case "clipboardWrite":
            UIPasteboard.general.string = p["text"] as? String ?? ""; reply(id, ["ok": true])
        case "clipboardRead": reply(id, ["ok": true, "text": UIPasteboard.general.string ?? ""])
        case "shareFile": shareFile(id, p)
        case "backupWrite": backupWrite(id, p)
        case "backupList": backupList(id)
        case "backupRead": backupRead(id, p)
        case "backupDelete": backupDelete(id, p)
        case "backupShare": backupShare(id, p)
        case "checkUpdate": lastCheck = .distantPast; checkUpdate(force: true, replyId: id)
        case "appInfo":
            reply(id, ["ok": true, "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
                       "lastUpdateCheck": UserDefaults.standard.double(forKey: "lastUpdateCheck")])
        default: reply(id, ["ok": false, "error": "unknown op"])
        }
    }

    func reply(_ id: String, _ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.web.evaluateJavaScript("window.__nativeReply && window.__nativeReply(\(String(reflecting: id)), \(json))", completionHandler: nil)
        }
    }

    // ---- 触觉 ----
    // ---- 提示音(系统按键音,跟随静音开关)与数字播报 ----
    func playKeySound(_ type: String) {
        switch type {
        case "delete": AudioServicesPlaySystemSound(1155)      // 键盘删除音
        case "action": AudioServicesPlaySystemSound(1156)      // 键盘功能键音
        case "tap":    AudioServicesPlaySystemSound(1104)      // 普通按钮:轻点音
        case "tab":    AudioServicesPlaySystemSound(1306)      // 标签/选项切换:轻咔嗒
        case "danger": AudioServicesPlaySystemSound(1107)      // 危险操作(清零/重置/删除):低沉
        case "success": AudioServicesPlaySystemSound(1407)     // 保存成功
        case "warning": AudioServicesPlaySystemSound(1053)     // 警告
        case "error":  AudioServicesPlaySystemSound(1521)      // 报错:短促震鸣音
        default: AudioServicesPlaySystemSound(1104)            // 键盘按键音
        }
    }
    lazy var synth = AVSpeechSynthesizer()
    lazy var zhVoice: AVSpeechSynthesisVoice? = AVSpeechSynthesisVoice(language: "zh-CN")
    // 预录的神经网络真人语音(晓晓):启动时全部载入内存,按键时直接播放,零延迟
    var voicePlayers: [String: AVAudioPlayer] = [:]
    var lastVoice: AVAudioPlayer?
    func preloadVoices() {
        let dir = Bundle.main.bundleURL.appendingPathComponent("www/voice")
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return }
        for f in files where f.hasSuffix(".mp3") {
            let key = String(f.dropLast(4))
            if let p = try? AVAudioPlayer(contentsOf: dir.appendingPathComponent(f)) {
                p.volume = 1.0; p.prepareToPlay(); voicePlayers[key] = p
            }
        }
    }
    func speak(_ text: String, key: String? = nil) {
        if text.isEmpty && key == nil { lastVoice?.stop(); synth.stopSpeaking(at: .immediate); return }
        lastVoice?.stop()                                      // 连续按键只读最新一个,不排队
        if let k = key, let p = voicePlayers[k] {
            p.currentTime = 0; p.play(); lastVoice = p; return
        }
        // 没有对应录音时回退到系统语音
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: text)
        u.voice = zhVoice
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.15)
        synth.speak(u)
    }
    func setupAudioSession() {
        // 与其他音频(音乐/播客)混音,不打断;静音开关打开时播报也能出声
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // 常驻的震动发生器 + prepare():避免每次现建导致首震延迟、力度偏弱
    lazy var gLight = UIImpactFeedbackGenerator(style: .light)
    lazy var gMedium = UIImpactFeedbackGenerator(style: .medium)
    lazy var gHeavy = UIImpactFeedbackGenerator(style: .heavy)
    lazy var gRigid = UIImpactFeedbackGenerator(style: .rigid)
    lazy var gNotify = UINotificationFeedbackGenerator()
    lazy var gSelect = UISelectionFeedbackGenerator()
    func haptic(_ type: String) {
        switch type {
        case "success": gNotify.notificationOccurred(.success); gNotify.prepare()
        case "warning": gNotify.notificationOccurred(.warning); gNotify.prepare()
        case "error": gNotify.notificationOccurred(.error); gNotify.prepare()
        case "selection": gSelect.selectionChanged(); gSelect.prepare()
        case "medium": gMedium.impactOccurred(intensity: 1.0); gMedium.prepare()
        case "heavy": gHeavy.impactOccurred(intensity: 1.0); gHeavy.prepare()
        case "rigid": gRigid.impactOccurred(intensity: 1.0); gRigid.prepare()
        default: gLight.impactOccurred(); gLight.prepare()
        }
    }

    // ---- 系统分享 ----
    func present(share items: [Any]) {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        (presentedViewController ?? self).present(vc, animated: true)
    }
    func shareFile(_ id: String, _ p: [String: Any]) {
        let name = (p["name"] as? String ?? "export.json").replacingOccurrences(of: "/", with: "_")
        guard let text = p["text"] as? String, let data = text.data(using: .utf8) else { return reply(id, ["ok": false, "error": "no data"]) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic) } catch { return reply(id, ["ok": false, "error": "\(error)"]) }
        present(share: [url]); reply(id, ["ok": true])
    }

    // ---- 备份保险箱 ----
    var backupDir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Backups")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    func safeName(_ s: String) -> String? {
        let n = s.replacingOccurrences(of: "/", with: "")
        return (n.isEmpty || n.hasPrefix(".") || !n.hasSuffix(".json")) ? nil : n
    }
    func backupWrite(_ id: String, _ p: [String: Any]) {
        guard let kind = p["kind"] as? String, let text = p["text"] as? String, let data = text.data(using: .utf8) else {
            return reply(id, ["ok": false, "error": "bad args"]) }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HH-mm-ss"; f.locale = Locale(identifier: "en_US_POSIX")
        let name = "\(kind)_\(f.string(from: Date())).json"
        let fm = FileManager.default
        do {
            try data.write(to: backupDir.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try data.write(to: backupDir.appendingPathComponent("latest.json"), options: .atomic)
        } catch { return reply(id, ["ok": false, "error": "\(error)"]) }
        // 滚动保留:自动备份最近 20 份,手动/快照最近 30 份
        let limits = ["auto": 20, "manual": 30, "snapshot": 5]
        if let lim = limits[kind], let files = try? fm.contentsOfDirectory(atPath: backupDir.path) {
            let mine = files.filter { $0.hasPrefix(kind + "_") }.sorted(by: >)
            for old in mine.dropFirst(lim) { try? fm.removeItem(at: backupDir.appendingPathComponent(old)) }
        }
        reply(id, ["ok": true, "name": name, "size": data.count])
    }
    func backupList(_ id: String) {
        let fm = FileManager.default
        let files = (try? fm.contentsOfDirectory(atPath: backupDir.path)) ?? []
        var out: [[String: Any]] = []
        for n in files where n.hasSuffix(".json") && n != "latest.json" {
            let a = try? fm.attributesOfItem(atPath: backupDir.appendingPathComponent(n).path)
            out.append(["name": n, "size": (a?[.size] as? Int) ?? 0,
                        "mtime": ((a?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000])
        }
        out.sort { ($0["mtime"] as? Double ?? 0) > ($1["mtime"] as? Double ?? 0) }
        reply(id, ["ok": true, "files": out])
    }
    func backupRead(_ id: String, _ p: [String: Any]) {
        guard let n = (p["name"] as? String).flatMap(safeName),
              let t = try? String(contentsOf: backupDir.appendingPathComponent(n), encoding: .utf8) else {
            return reply(id, ["ok": false, "error": "读取失败"]) }
        reply(id, ["ok": true, "text": t])
    }
    func backupDelete(_ id: String, _ p: [String: Any]) {
        guard let n = (p["name"] as? String).flatMap(safeName) else { return reply(id, ["ok": false, "error": "bad name"]) }
        try? FileManager.default.removeItem(at: backupDir.appendingPathComponent(n)); reply(id, ["ok": true])
    }
    func backupShare(_ id: String, _ p: [String: Any]) {
        guard let n = (p["name"] as? String).flatMap(safeName) else { return reply(id, ["ok": false, "error": "bad name"]) }
        present(share: [backupDir.appendingPathComponent(n)]); reply(id, ["ok": true])
    }

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.scheme == "app" || u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" {
            decisionHandler(.allow)
        } else if let u = a.request.url {
            UIApplication.shared.open(u); decisionHandler(.cancel)
        } else { decisionHandler(.cancel) }
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { if u.scheme == "app" { w.load(a.request) } else { UIApplication.shared.open(u) } }
        return nil
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText d: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: p, preferredStyle: .alert)
        a.addTextField { $0.text = d }
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = VC()
        window?.makeKeyAndVisible()
        return true
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
