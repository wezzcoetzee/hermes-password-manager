// Mirror of src/shared/crypto.ts. Change both together.
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto // swift-crypto, used by scripts/verify-crypto-interop.sh on Linux
#endif
import Foundation

enum ProtocolCrypto {
    static let sealInfo = "agentvault/credential/v1"
    static let maxClockSkewMs: Double = 30_000

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func requestSigningInput(path: String, ts: String, nonce: String, body: Data) -> Data {
        Data("POST\n\(path)\n\(ts)\n\(nonce)\n\(sha256Hex(body))".utf8)
    }

    static func responseSigningInput(nonce: String, payload: Data) -> Data {
        Data("\(nonce)\n\(sha256Hex(payload))".utf8)
    }

    /// Verifies a raw (r||s) ECDSA P-256 / SHA-256 signature, as produced by Node with dsaEncoding 'ieee-p1363'.
    static func verify(publicKeyPEM: String, data: Data, signatureBase64: String) -> Bool {
        guard let key = try? P256.Signing.PublicKey(pemRepresentation: publicKeyPEM),
              let raw = Data(base64Encoded: signatureBase64),
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: raw) else { return false }
        return key.isValidSignature(signature, for: data)
    }

    static func sign(_ key: P256.Signing.PrivateKey, _ data: Data) throws -> String {
        try key.signature(for: data).rawRepresentation.base64EncodedString()
    }

    struct Sealed: Encodable { let epk: String; let box: String }

    /// Ephemeral ECDH P-256 + HKDF-SHA256(salt: context, info: sealInfo) + AES-256-GCM (combined = nonce || ct || tag).
    static func seal(recipientPEM: String, context: String, plaintext: Data) throws -> Sealed {
        let recipient = try P256.KeyAgreement.PublicKey(pemRepresentation: recipientPEM)
        let ephemeral = P256.KeyAgreement.PrivateKey()
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(context.utf8), sharedInfo: Data(sealInfo.utf8), outputByteCount: 32)
        guard let combined = try AES.GCM.seal(plaintext, using: key).combined else { throw CryptoError.sealFailed }
        return Sealed(epk: ephemeral.publicKey.x963Representation.base64EncodedString(), box: combined.base64EncodedString())
    }

    static func fingerprint(_ pem: String) -> String {
        String(sha256Hex(Data(pem.utf8)).prefix(16)).uppercased().enumerated()
            .map { $0.offset > 0 && $0.offset % 4 == 0 ? " \($0.element)" : "\($0.element)" }.joined()
    }
}

enum CryptoError: Error { case sealFailed }
