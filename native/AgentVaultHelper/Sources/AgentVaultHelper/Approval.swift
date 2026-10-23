// Native prompts. Every approval is an explicit click followed by device-owner authentication
// (Touch ID or the login password), which another process cannot synthesise with scripted clicks.
import AppKit
import CoreGraphics
import LocalAuthentication

enum Decision: String, Encodable { case approved, denied, unavailable }

enum Approval {
    static let timeout: TimeInterval = 120

    /// False when the screen is locked or nobody is logged in at the console. Callers answer `unavailable`.
    static func userPresent() -> Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        let onConsole = session["kCGSSessionOnConsoleKey"] as? Bool ?? false
        let locked = session["CGSSessionScreenIsLocked"] as? Bool ?? false
        return onConsole && !locked
    }

    /// Website-derived text is untrusted: one line, bounded, so it cannot forge extra rows in the prompt.
    static func clean(_ value: String) -> String {
        let flat = value.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return flat.count > 120 ? String(flat.prefix(120)) + "…" : flat
    }

    /// Call from a background queue. Blocks until the user decides or the prompt times out.
    static func ask(title: String, rows: [(String, String)], approveLabel: String, reason: String) -> Decision {
        guard userPresent() else { return .unavailable }
        let clicked: Bool = DispatchQueue.main.sync {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = rows.map { "\($0.0): \(clean($0.1))" }.joined(separator: "\n")
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Deny") // default button, so Return never approves
            alert.addButton(withTitle: approveLabel)
            NSApp.activate(ignoringOtherApps: true)
            let timer = Timer(timeInterval: timeout, repeats: false) { _ in NSApp.abortModal() }
            RunLoop.main.add(timer, forMode: .modalPanel)
            defer { timer.invalidate() }
            return alert.runModal() == .alertSecondButtonReturn
        }
        guard clicked else { return .denied }
        return authenticate(reason: reason) ? .approved : .denied
    }

    static func authenticate(reason: String) -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        let done = DispatchSemaphore(value: 0)
        var ok = false
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
            ok = success
            done.signal()
        }
        done.wait()
        return ok
    }

    /// Enrollment form. Runs on the main thread from the CLI.
    static func credentialForm(origin: String, account: String, username: String?) -> (username: String, password: String)? {
        let alert = NSAlert()
        alert.messageText = "Save a credential for \(origin)"
        alert.informativeText = "Account \(account). Stored in your login Keychain. AI agents never see it."
        let userField = NSTextField(frame: NSRect(x: 0, y: 30, width: 300, height: 24))
        userField.placeholderString = "Username or email"
        userField.stringValue = username ?? ""
        let passwordField = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        passwordField.placeholderString = "Password"
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 54))
        container.addSubview(userField)
        container.addSubview(passwordField)
        alert.accessoryView = container
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = username == nil ? userField : passwordField
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn,
              !userField.stringValue.isEmpty, !passwordField.stringValue.isEmpty else { return nil }
        return (userField.stringValue, passwordField.stringValue)
    }

    static func confirm(title: String, message: String, confirmLabel: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: confirmLabel)
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertSecondButtonReturn
    }
}
