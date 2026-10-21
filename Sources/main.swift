import UIKit
import WebKit
import AVFoundation
import AudioToolbox
import UniformTypeIdentifiers

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

final class VC: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
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
        // 触觉/提示音/播报是"发完即忘":不再回调 JS(每次回调都是一次 evaluateJavaScript,连按键盘时会堵主线程);
        // 声音与播报放到独立串行队列,不占主线程。
        case "haptic": haptic(p["type"] as? String ?? "light"); if id != "h" { reply(id, ["ok": true]) }
        case "sound":
            let t = p["type"] as? String ?? "key"
            audioQueue.async { self.playKeySound(t) }
            if id != "s" { reply(id, ["ok": true]) }
        case "speak":
            let tx = p["text"] as? String ?? "", k = p["key"] as? String
            let rt = p["rate"] as? Double ?? 1.0, vl = p["vol"] as? Double ?? 1.0
            audioQueue.async { self.speak(tx, key: k, rate: rt, vol: vl) }
            if id != "s" { reply(id, ["ok": true]) }
        case "clipboardWrite":
            UIPasteboard.general.string = p["text"] as? String ?? ""; reply(id, ["ok": true])
        case "clipboardRead": reply(id, ["ok": true, "text": UIPasteboard.general.string ?? ""])
        case "shareFile": shareFile(id, p)
        case "backupWrite": backupWrite(id, p)
        case "backupList": backupList(id)
        case "backupRead": backupRead(id, p)
        case "backupDelete": backupDelete(id, p)
        case "backupShare": backupShare(id, p)
        case "watchPick": watchPick(id)
        case "watchLocal":
            UserDefaults.standard.removeObject(forKey: "watchBookmark")
            UserDefaults.standard.set(true, forKey: "watchLocal"); UserDefaults.standard.set("Caja/资金到账导入", forKey: "watchName")
            _ = localWatchDir
            reply(id, ["ok": true, "name": "Caja/资金到账导入"])
        case "watchInfo": reply(id, ["ok": true, "name": UserDefaults.standard.string(forKey: "watchName") ?? ""])
        case "watchClear":
            UserDefaults.standard.removeObject(forKey: "watchBookmark"); UserDefaults.standard.removeObject(forKey: "watchName"); UserDefaults.standard.removeObject(forKey: "watchLocal")
            reply(id, ["ok": true])
        case "watchScan": watchScan(id, last: p["last"] as? String ?? "")
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
    // 预录的神经网络真人语音(晓晓,1.4 倍速,每个约 0.25 秒)。
    // 用 AVAudioEngine:启动时把 17 段录音解码成内存缓冲区,按键时立即调度播放,延迟极低。
    // 允许重叠:每次按键马上响,上一个没读完也不打断、不排队、不丢弃(轮流使用 8 个播放节点)。
    let voiceEngine = AVAudioEngine()
    var voiceBuffers: [String: AVAudioPCMBuffer] = [:]
    var voiceNodes: [AVAudioPlayerNode] = []
    var voiceRateUnits: [AVAudioUnitTimePitch] = []        // 变速不变调:语速 0.6×~1.8× 都不会变尖或变粗
    var voiceNodeIdx = 0
    // 追赶式播报:连按时,新数字一来上一个在 ~30ms 内淡出收尾(避免声音叠在一起),
    // 并按手速自动加快语速(间隔越短越快,最高 1.8×),保证耳朵里始终只有最新一键的清晰数字。
    var lastSpeakAt = Date.distantPast
    var curNode = -1
    var nodeGen: [Int] = Array(repeating: 0, count: 8)
    func fadeOut(_ i: Int) {
        guard i >= 0, i < voiceNodes.count else { return }
        nodeGen[i] += 1; let gen = nodeGen[i]
        let node = voiceNodes[i], v0 = node.volume
        let steps = 6
        for k in 1...steps {
            audioQueue.asyncAfter(deadline: .now() + 0.005 * Double(k)) { [weak self] in
                guard let self = self, self.nodeGen[i] == gen else { return }   // 该通道已被新播放接管
                if k == steps { node.stop(); node.volume = v0 } else { node.volume = v0 * Float(steps - k) / Float(steps) }
            }
        }
    }
    func preloadVoices() {
        var format: AVAudioFormat?
        var entries: [(String, URL)] = []
        for (sub, prefix) in [("www/voice", ""), ("www/voice-yi", "yi/")] {
            let d = Bundle.main.bundleURL.appendingPathComponent(sub)
            guard let fs = try? FileManager.default.contentsOfDirectory(atPath: d.path) else { continue }
            for f in fs where f.hasSuffix(".mp3") { entries.append((prefix + String(f.dropLast(4)), d.appendingPathComponent(f))) }
        }
        for (key, url) in entries {
            guard let file = try? AVAudioFile(forReading: url),
                  let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else { continue }
            do { try file.read(into: buf) } catch { continue }
            if format == nil { format = file.processingFormat }
            guard let fmt = format, buf.format.sampleRate == fmt.sampleRate, buf.format.channelCount == fmt.channelCount else { continue }
            voiceBuffers[key] = buf
        }
        guard let fmt = format else { return }
        for _ in 0..<8 {
            let node = AVAudioPlayerNode()
            let tp = AVAudioUnitTimePitch()
            voiceEngine.attach(node); voiceEngine.attach(tp)
            voiceEngine.connect(node, to: tp, format: fmt)
            voiceEngine.connect(tp, to: voiceEngine.mainMixerNode, format: fmt)
            voiceNodes.append(node); voiceRateUnits.append(tp)
        }
        voiceEngine.prepare()
        try? voiceEngine.start()
    }
    // rate:1.0 为录音原速(已是 1.4 倍裁紧版);vol:0~1
    func speak(_ text: String, key: String? = nil, rate: Double = 1.0, vol: Double = 1.0) {
        if text.isEmpty && key == nil {                        // 关闭播报:全部停止
            for (i, n) in voiceNodes.enumerated() { nodeGen[i] += 1; n.stop() }; curNode = -1
            synth.stopSpeaking(at: .immediate); return
        }
        let r = min(1.8, max(0.6, rate)), v = Float(min(1.0, max(0.0, vol)))
        if v <= 0.001 { return }                               // 音量拉到 0 等于静音
        if let k = key, let buf = voiceBuffers[k] ?? voiceBuffers[k.hasPrefix("yi/") ? String(k.dropFirst(3)) : k], !voiceNodes.isEmpty {
            if !voiceEngine.isRunning { try? voiceEngine.start() }   // 被电话/Siri 等打断后自动恢复
            if voiceEngine.isRunning {
                let nowT = Date(); let gap = nowT.timeIntervalSince(lastSpeakAt); lastSpeakAt = nowT
                let bare = k.hasPrefix("yi/") ? String(k.dropFirst(3)) : k
                let isDigitKey = bare.count <= 2 || bare == "dot" || bare == "neg"          // 数字/小数点/负号才追赶,功能键(删除/清空/确认)读完整
                var rr = r
                if isDigitKey && gap < 0.45 {
                    let boost: Double = gap > 0.25 ? 1.25 : (gap > 0.17 ? 1.5 : 1.8)
                    rr = min(1.8, max(r, boost))
                }
                if isDigitKey && curNode >= 0 && gap < 0.45 { fadeOut(curNode) }    // 上一个快速淡出;慢速按键不打断
                let i = voiceNodeIdx
                voiceNodeIdx = (voiceNodeIdx + 1) % voiceNodes.count
                nodeGen[i] += 1                                                     // 取消该通道上尚未完成的淡出
                curNode = i
                let node = voiceNodes[i]
                voiceRateUnits[i].rate = Float(rr)
                voiceRateUnits[i].bypass = abs(rr - 1.0) < 0.01   // 原速时绕过变速单元,省掉它的处理延迟
                node.volume = v
                node.stop()
                node.scheduleBuffer(buf, at: nil, options: [], completionHandler: nil)
                node.play()
                return
            }
        }
        // 没有对应录音或引擎起不来时,回退到系统语音
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: text)
        u.voice = zhVoice
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.15 * Float(r))
        u.volume = v
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
    let audioQueue = DispatchQueue(label: "caja.audio", qos: .userInteractive)
    lazy var gNotify = UINotificationFeedbackGenerator()
    lazy var gSelect = UISelectionFeedbackGenerator()
    // 触觉引擎闲置几秒会休眠,下一次震动要先唤醒,会让主线程顿一下(键盘表现为短暂卡住)。
    // 有触摸活动时每秒给所有发生器 prepare 一次,保持待命;停手 8 秒后不再唤醒,省电。
    var lastTouchAt = Date.distantPast
    var warmTimer: Timer?
    func warmHaptics() {
        lastTouchAt = Date()
        if warmTimer != nil { return }
        warmTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            if Date().timeIntervalSince(self.lastTouchAt) > 8 { t.invalidate(); self.warmTimer = nil; return }
            self.gLight.prepare(); self.gRigid.prepare()
        }
        gLight.prepare(); gRigid.prepare()
    }
    func haptic(_ type: String) {
        warmHaptics()
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

    // ---- 监控文件夹(资金到账自动导入):选一次文件夹,保存安全书签;打开页面/回前台时读取其中最新的 json/csv ----
    var localWatchDir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("资金到账导入")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    var watchPickId: String?
    func watchPick(_ id: String) {
        // 旧式初始化(.open 模式)对「原地打开文件夹」更稳:返回的文件夹自带安全作用域权限
        let pk = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
        pk.delegate = self; pk.allowsMultipleSelection = false
        watchPickId = id
        (presentedViewController ?? self).present(pk, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let id = watchPickId else { return }; watchPickId = nil
        guard let u = urls.first else { return reply(id, ["ok": false, "error": "cancel"]) }
        let ok = u.startAccessingSecurityScopedResource(); defer { if ok { u.stopAccessingSecurityScopedResource() } }
        var bmData: Data?; var why = ""
        do { bmData = try u.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) }
        catch let e1 {
            why = "\(e1.localizedDescription)"
            do { bmData = try u.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil) }
            catch let e2 { why += " / \(e2.localizedDescription)" }
        }
        guard let bm = bmData else { return reply(id, ["ok": false, "error": "bookmark", "detail": "access=\(ok) \(why)"]) }
        UserDefaults.standard.set(bm, forKey: "watchBookmark"); UserDefaults.standard.removeObject(forKey: "watchLocal")
        UserDefaults.standard.set(u.lastPathComponent, forKey: "watchName")
        reply(id, ["ok": true, "name": u.lastPathComponent])
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let id = watchPickId { watchPickId = nil; reply(id, ["ok": false, "error": "cancel"]) }
    }
    func watchScan(_ id: String, last: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            let dir: URL
            var ok = false
            if UserDefaults.standard.bool(forKey: "watchLocal") {
                dir = self.localWatchDir
            } else {
                guard let bm = UserDefaults.standard.data(forKey: "watchBookmark") else { return self.reply(id, ["ok": false, "error": "none"]) }
                var stale = false
                guard let d = try? URL(resolvingBookmarkData: bm, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
                    return self.reply(id, ["ok": false, "error": "resolve"]) }
                dir = d
                ok = dir.startAccessingSecurityScopedResource()
                if stale, let nb = try? dir.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) { UserDefaults.standard.set(nb, forKey: "watchBookmark") }
            }
            defer { if ok { dir.stopAccessingSecurityScopedResource() } }
            let fm = FileManager.default
            var names: [String] = []; var err: NSError?
            NSFileCoordinator().coordinate(readingItemAt: dir, options: [], error: &err) { d in
                names = (try? fm.contentsOfDirectory(atPath: d.path)) ?? []
            }
            if err != nil { return self.reply(id, ["ok": false, "error": "list"]) }
            var best: (URL, Date, Int)?; var downloading = false
            for n in names {
                var real = n
                if n.hasPrefix(".") && n.hasSuffix(".icloud") {              // iCloud 占位文件:触发下载,稍后再读
                    real = String(n.dropFirst().dropLast(7))
                    let ext = (real as NSString).pathExtension.lowercased()
                    if ext == "json" || ext == "csv" { try? fm.startDownloadingUbiquitousItem(at: dir.appendingPathComponent(real)); downloading = true }
                    continue
                }
                let ext = (n as NSString).pathExtension.lowercased()
                guard ext == "json" || ext == "csv", !n.hasPrefix(".") else { continue }
                let u = dir.appendingPathComponent(real)
                let v = try? u.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                let m = v?.contentModificationDate ?? .distantPast
                if best == nil || m > best!.1 { best = (u, m, v?.fileSize ?? 0) }
            }
            guard let b = best else { return self.reply(id, ["ok": true, "empty": true, "downloading": downloading]) }
            let sig = "\(b.0.lastPathComponent)|\(Int(b.1.timeIntervalSince1970))|\(b.2)"
            if sig == last { return self.reply(id, ["ok": true, "same": true, "name": b.0.lastPathComponent]) }
            var data: Data?; var err2: NSError?
            NSFileCoordinator().coordinate(readingItemAt: b.0, options: [], error: &err2) { u in data = try? Data(contentsOf: u) }
            guard let d = data, let text = String(data: d, encoding: .utf8) else { return self.reply(id, ["ok": false, "error": "read", "name": b.0.lastPathComponent]) }
            self.reply(id, ["ok": true, "name": b.0.lastPathComponent, "sig": sig, "mtime": b.1.timeIntervalSince1970, "text": text])
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
