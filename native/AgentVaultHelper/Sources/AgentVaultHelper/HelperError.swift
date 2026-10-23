import Foundation
import Security

enum HelperError: Error, CustomStringConvertible {
    case notPaired, keychain(OSStatus), usage(String)
    var description: String {
        switch self {
        case .notPaired: return "not paired with a broker; run `agentvault pair`"
        case .keychain(let status): return "keychain error \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
        case .usage(let message): return message
        }
    }
}
