// The helper's two endpoints. Mirrors src/dev-helper/helper.ts; both must satisfy src/broker/helper-client.ts.
import CryptoKit
import Foundation

struct SiteRef: Decodable { let name: String; let origin: String }
struct LoginRequest: Decodable {
    struct Account: Decodable { let id: String; let username: String }
    let requestId: String; let agent: String; let site: SiteRef; let account: Account; let durationMinutes: Int
    let unattended: Bool? // the broker already has chat or auto consent
}
struct OrderItem: Decodable { let name: String; let variant: String; let quantity: String; let unitPrice: String }
struct OrderSummary: Decodable {
    let merchant: String; let items: [OrderItem]; let shipping: String; let total: String
    let currency: String; let address: String; let paymentMethod: String
}
struct TransactionRequest: Decodable { let requestId: String; let agent: String; let site: SiteRef; let summary: OrderSummary }

private struct LoginResult: Encodable { let requestId: String; let decision: Decision; let sealed: ProtocolCrypto.Sealed? }
private struct TransactionResult: Encodable { let requestId: String; let decision: Decision }
private struct SignedResponse: Encodable { let payload: String; let signature: String }

final class HelperService {
    private let signingKey: P256.Signing.PrivateKey
    private let broker: (signing: String, sealing: String)
    private var seenNonces: [String: Date] = [:] // touched only on the server's serial queue

    init() throws {
        signingKey = try Keychain.helperSigningKey()
        broker = try Keychain.brokerKeys()
    }

    func handle(_ request: HTTPRequest) -> (Int, Data) {
        guard request.method == "POST" else { return error(404, "not_found") }
        guard let nonce = authenticate(request) else { return error(401, "unauthorized") }
        do {
            switch request.path {
            case "/v1/login": return try respond(nonce, login(try JSONDecoder().decode(LoginRequest.self, from: request.body)))
            case "/v1/transaction": return try respond(nonce, transaction(try JSONDecoder().decode(TransactionRequest.self, from: request.body)))
            default: return error(404, "not_found")
            }
        } catch {
            return self.error(400, "invalid_request")
        }
    }

    /// Signature by the pinned broker key, fresh timestamp, unused nonce.
    private func authenticate(_ request: HTTPRequest) -> String? {
        guard let ts = request.headers["x-av-ts"], let nonce = request.headers["x-av-nonce"], let signature = request.headers["x-av-signature"],
              let millis = Double(ts), abs(Date().timeIntervalSince1970 * 1000 - millis) <= ProtocolCrypto.maxClockSkewMs,
              seenNonces[nonce] == nil,
              ProtocolCrypto.verify(publicKeyPEM: broker.signing,
                                    data: ProtocolCrypto.requestSigningInput(path: request.path, ts: ts, nonce: nonce, body: request.body),
                                    signatureBase64: signature)
        else { return nil }
        let cutoff = Date().addingTimeInterval(-2 * ProtocolCrypto.maxClockSkewMs / 1000) // nonces outlive the skew window
        seenNonces = seenNonces.filter { $0.value > cutoff }
        seenNonces[nonce] = Date()
        return nonce
    }

    private func login(_ req: LoginRequest) throws -> LoginResult {
        // The Keychain item, not the broker, decides which origin and username a credential belongs to.
        guard let stored = try Keychain.credentialMetadata(account: req.account.id),
              stored.origin == req.site.origin, stored.username == req.account.username
        else { return LoginResult(requestId: req.requestId, decision: .denied, sealed: nil) }

        // Skipping the prompt needs both the broker's consent and this account's own unattended flag,
        // so a compromised broker cannot release credentials the user never marked unattended.
        let unattended = req.unattended == true && stored.unattended == true
        let decision: Decision = unattended ? .approved : Approval.ask(
            title: "\(Approval.clean(req.agent)) wants to sign in",
            rows: [("Website", req.site.origin), ("Site", req.site.name), ("Account", stored.username),
                   ("Operation", "Sign in (password entered by AgentVault, never shown to the agent)"),
                   ("Session", "\(req.durationMinutes) minutes")],
            approveLabel: "Approve once",
            reason: "approve signing in to \(req.site.origin)")
        guard decision == .approved, let password = try Keychain.password(account: req.account.id) else {
            return LoginResult(requestId: req.requestId, decision: decision == .approved ? .denied : decision, sealed: nil)
        }
        let plaintext = try JSONSerialization.data(withJSONObject: ["username": stored.username, "password": String(decoding: password, as: UTF8.self)])
        let sealed = try ProtocolCrypto.seal(recipientPEM: broker.sealing, context: req.requestId, plaintext: plaintext)
        return LoginResult(requestId: req.requestId, decision: .approved, sealed: sealed)
    }

    private func transaction(_ req: TransactionRequest) -> TransactionResult {
        let s = req.summary
        // Money and destination first, so a long item list can never push them out of view.
        var rows: [(String, String)] = [
            ("Merchant", "\(s.merchant) (\(req.site.origin))"), ("Total", "\(s.total) \(s.currency)"),
            ("Shipping", "\(s.shipping) \(s.currency)"), ("Deliver to", s.address), ("Payment method", s.paymentMethod),
        ]
        for item in s.items {
            rows.append(("Product", item.name))
            rows.append(("  Size / variant", item.variant))
            rows.append(("  Quantity", item.quantity))
            rows.append(("  Unit price", "\(item.unitPrice) \(s.currency)"))
        }
        let decision = Approval.ask(
            title: "\(Approval.clean(req.agent)) wants to place an order",
            rows: rows,
            approveLabel: "Approve purchase",
            reason: "approve a purchase of \(s.total) \(s.currency) at \(s.merchant)")
        return TransactionResult(requestId: req.requestId, decision: decision)
    }

    private func respond<T: Encodable>(_ nonce: String, _ result: T) throws -> (Int, Data) {
        let payload = try JSONEncoder().encode(result)
        let signature = try ProtocolCrypto.sign(signingKey, ProtocolCrypto.responseSigningInput(nonce: nonce, payload: payload))
        return (200, try JSONEncoder().encode(SignedResponse(payload: String(decoding: payload, as: UTF8.self), signature: signature)))
    }

    private func error(_ status: Int, _ code: String) -> (Int, Data) {
        (status, Data("{\"error\":\"\(code)\"}".utf8))
    }
}
