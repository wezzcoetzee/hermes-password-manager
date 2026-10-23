// AgentVaultHelper: native macOS side of AgentVault.
//   pair                                  broker public keys JSON on stdin; prints this helper's public key
//   enroll --account <id> --origin <url> [--username <u>]
//   delete --account <id>
//   serve [--port 47800]                  run under launchd in the user's GUI session
import AppKit
import Foundation

func option(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: "--\(name)"), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func require(_ name: String) throws -> String {
    guard let value = option(name) else { throw HelperError.usage("missing --\(name)") }
    return value
}

func run() throws {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // no Dock icon; alerts still come to the front

    switch CommandLine.arguments.dropFirst().first {
    case "pair":
        struct BrokerKeys: Decodable { let signing: String; let sealing: String }
        let keys = try JSONDecoder().decode(BrokerKeys.self, from: FileHandle.standardInput.readDataToEndOfFile())
        // Pinning decides who may ask for credentials, so it needs the same proof of presence as an approval.
        guard Approval.confirm(title: "Pair AgentVault with this broker?",
                               message: "Broker fingerprint \(ProtocolCrypto.fingerprint(keys.signing)). Only continue if you just ran `agentvault pair`.",
                               confirmLabel: "Pair"),
              Approval.authenticate(reason: "pair AgentVault with a credential broker")
        else { throw HelperError.usage("pairing cancelled") }
        try Keychain.pinBroker(signing: keys.signing, sealing: keys.sealing)
        print(try Keychain.helperSigningKey().publicKey.pemRepresentation)

    case "enroll":
        let account = try require("account")
        guard let url = URL(string: try require("origin")), let scheme = url.scheme, let host = url.host else { throw HelperError.usage("invalid --origin") }
        let origin = "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
        guard let entry = Approval.credentialForm(origin: origin, account: account, username: option("username")) else { throw HelperError.usage("enrollment cancelled") }
        try Keychain.saveCredential(account: account, origin: origin, username: entry.username, password: entry.password)
        let out = try JSONSerialization.data(withJSONObject: ["account": account, "username": entry.username])
        print(String(decoding: out, as: UTF8.self))

    case "delete":
        let account = try require("account")
        guard Approval.authenticate(reason: "delete the AgentVault credential \(account)") else { throw HelperError.usage("not authorised") }
        try Keychain.deleteCredential(account: account)

    case "serve":
        let service = try HelperService()
        let server = try HTTPServer(port: UInt16(option("port") ?? "47800") ?? 47800, handler: service.handle)
        server.start()
        FileHandle.standardError.write(Data("AgentVaultHelper listening on 127.0.0.1\n".utf8))
        app.run()

    default:
        print("Usage: AgentVaultHelper pair | enroll --account <id> --origin <url> [--username <u>] | delete --account <id> | serve [--port <n>]")
    }
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("error: \(error)\n".utf8))
    exit(1)
}
