import UIKit
import WebKit

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
                     "json": "application/json", "svg": "image/svg+xml"]
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
        apply()
        web.load(URLRequest(url: URL(string: "app://localhost/index.html")!))
        NotificationCenter.default.addObserver(self, selector: #selector(apply), name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    var lastCheck = Date.distantPast
    @objc func apply() {
        UIApplication.shared.isIdleTimerDisabled = keepAwake
        checkUpdate()
    }

    func checkUpdate() {
        if Date().timeIntervalSince(lastCheck) < 600 { return }
        lastCheck = Date()
        guard let url = URL(string: "https://api.github.com/repos/leohenshuai/caja-ios/releases/latest") else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self, let data = data,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = j["tag_name"] as? String,
                  let latest = Int(tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))) else { return }
            let cur = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
            let skipped = UserDefaults.standard.integer(forKey: "skipVersion")
            guard latest > cur, latest != skipped else { return }
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
        if let b = m.body as? Bool {
            keepAwake = b
            UserDefaults.standard.set(b, forKey: "keepAwake")
            apply()
        }
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
