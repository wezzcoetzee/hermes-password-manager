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
        // Drop control and format characters (bidi overrides, zero-width) so displayed text matches what was hashed.
        let visible = String(String.UnicodeScalarView(value.unicodeScalars.filter {
            $0.properties.generalCategory != .control && $0.properties.generalCategory != .format
        }))
        let flat = visible.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return flat.count > 120 ? String(flat.prefix(120)) + "…" : flat
    }

    /// Call from a background queue. Blocks until the user decides or the prompt times out. Touch ID is
    /// bounded too: requests are served one at a time, so a sheet left open would otherwise stall every
    /// later request and could approve one the broker has already given up on (it waits 130s).
    static func ask(title: String, rows: [(String, String)], approveLabel: String, reason: String) -> Decision {
        guard userPresent() else { return .unavailable }
        let deadline = Date().addingTimeInterval(timeout)
        let choice: Decision = DispatchQueue.main.sync {
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
            switch alert.runModal() {
            case .alertSecondButtonReturn: return .approved
            case .abort: return .unavailable // nobody answered
            default: return .denied
            }
        }
        guard choice == .approved else { return choice }
        // A click just before the deadline still gets a few seconds for Touch ID, within the broker's wait.
        return authenticate(reason: reason, until: max(deadline, Date().addingTimeInterval(8))) ? .approved : .denied
    }

    /// Device-owner authentication. With a deadline, an unanswered sheet is dismissed and counts as a failure.
    static func authenticate(reason: String, until deadline: Date? = nil) -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        let done = DispatchSemaphore(value: 0)
        var ok = false
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
            ok = success
            done.signal()
        }
        guard let deadline else {
            done.wait()
            return ok
        }
        if done.wait(wallTimeout: .now() + max(0, deadline.timeIntervalSinceNow)) == .timedOut {
            context.invalidate() // closes the sheet; the reply then arrives as a failure
            done.wait()
            return false
        }
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
