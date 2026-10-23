// Credentials and helper keys live in the user's login Keychain. Items are created by this
// signed binary, so macOS asks before any other application can read them.
import CryptoKit
import Foundation
import Security

struct StoredCredential: Codable {
    let origin: String
    let username: String
    /// Release without a prompt when the broker already has chat or auto consent. Absent on older items, which means no.
    var unattended: Bool?
}

enum Keychain {
    static let credentialService = "dev.agentvault.credential"
    static let keyService = "dev.agentvault.keys"

    private static func base(service: String, account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func upsert(service: String, account: String, secret: Data, label: String, metadata: Data? = nil) throws {
        var attributes: [String: Any] = [
            kSecValueData as String: secret,
            kSecAttrLabel as String: label,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, // never synced, unreadable while locked
        ]
        if let metadata { attributes[kSecAttrGeneric as String] = metadata }
        let query = base(service: service, account: account)
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let added = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
            guard added == errSecSuccess else { throw HelperError.keychain(added) }
        } else if status != errSecSuccess {
            throw HelperError.keychain(status)
        }
    }

    private static func read(service: String, account: String, attributesOnly: Bool = false) throws -> [String: Any]? {
        var query = base(service: service, account: account)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnAttributes as String] = true
        if !attributesOnly { query[kSecReturnData as String] = true }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw HelperError.keychain(status) }
        return result as? [String: Any]
    }

    static func delete(service: String, account: String) throws {
        let status = SecItemDelete(base(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw HelperError.keychain(status) }
    }

    // MARK: credentials

    static func saveCredential(account: String, origin: String, username: String, password: String) throws {
        let metadata = try JSONEncoder().encode(StoredCredential(origin: origin, username: username))
        try upsert(service: credentialService, account: account, secret: Data(password.utf8), label: "AgentVault: \(origin)", metadata: metadata)
    }

    /// Metadata only; does not touch the password.
    static func credentialMetadata(account: String) throws -> StoredCredential? {
        guard let item = try read(service: credentialService, account: account, attributesOnly: true),
              let data = item[kSecAttrGeneric as String] as? Data else { return nil }
        return try? JSONDecoder().decode(StoredCredential.self, from: data)
    }

    /// Rewrites only the metadata; the password is not read. Re-enrolling clears the flag.
    static func setUnattended(account: String, _ enabled: Bool) throws {
        guard var stored = try credentialMetadata(account: account) else { throw HelperError.usage("no credential enrolled for \(account)") }
        stored.unattended = enabled
        let attributes = [kSecAttrGeneric as String: try JSONEncoder().encode(stored)]
        let status = SecItemUpdate(base(service: credentialService, account: account) as CFDictionary, attributes as CFDictionary)
        guard status == errSecSuccess else { throw HelperError.keychain(status) }
    }

    static func password(account: String) throws -> Data? {
        try read(service: credentialService, account: account)?[kSecValueData as String] as? Data
    }

    static func deleteCredential(account: String) throws { try delete(service: credentialService, account: account) }

    // MARK: protocol keys

    static func helperSigningKey() throws -> P256.Signing.PrivateKey {
        if let data = try read(service: keyService, account: "helper-signing")?[kSecValueData as String] as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        let key = P256.Signing.PrivateKey()
        try upsert(service: keyService, account: "helper-signing", secret: key.rawRepresentation, label: "AgentVault helper signing key")
        return key
    }

    /// The broker keys are pinned in the Keychain, not a file, so another process cannot quietly swap them.
    static func pinBroker(signing: String, sealing: String) throws {
        try upsert(service: keyService, account: "broker-signing", secret: Data(signing.utf8), label: "AgentVault broker signing key")
        try upsert(service: keyService, account: "broker-sealing", secret: Data(sealing.utf8), label: "AgentVault broker sealing key")
    }

    static func brokerKeys() throws -> (signing: String, sealing: String) {
        guard let signing = try read(service: keyService, account: "broker-signing")?[kSecValueData as String] as? Data,
              let sealing = try read(service: keyService, account: "broker-sealing")?[kSecValueData as String] as? Data
        else { throw HelperError.notPaired }
        return (String(decoding: signing, as: UTF8.self), String(decoding: sealing, as: UTF8.self))
    }
}
