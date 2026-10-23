// Swift half of the interop check. Crypto.swift is copied in from the helper by the script.
import Crypto
import Foundation

struct Fixture: Decodable { let signing, sealing, path, ts, nonce, body, signature, context, plaintext: String }
struct Out: Encodable {
    let helperPub, payload, signature: String
    let sealed: ProtocolCrypto.Sealed
    let verifiedRequest, rejectedTampered: Bool
}

let dir = CommandLine.arguments[1]
let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: "\(dir)/fixture.json")))
let input = ProtocolCrypto.requestSigningInput(path: fixture.path, ts: fixture.ts, nonce: fixture.nonce, body: Data(fixture.body.utf8))
let tampered = ProtocolCrypto.requestSigningInput(path: fixture.path, ts: fixture.ts, nonce: fixture.nonce, body: Data((fixture.body + " ").utf8))
let helperKey = P256.Signing.PrivateKey()
let payload = "{\"requestId\":\"req_interop\",\"decision\":\"approved\"}"
let out = Out(
    helperPub: helperKey.publicKey.pemRepresentation,
    payload: payload,
    signature: try ProtocolCrypto.sign(helperKey, ProtocolCrypto.responseSigningInput(nonce: fixture.nonce, payload: Data(payload.utf8))),
    sealed: try ProtocolCrypto.seal(recipientPEM: fixture.sealing, context: fixture.context, plaintext: Data(fixture.plaintext.utf8)),
    verifiedRequest: ProtocolCrypto.verify(publicKeyPEM: fixture.signing, data: input, signatureBase64: fixture.signature),
    rejectedTampered: !ProtocolCrypto.verify(publicKeyPEM: fixture.signing, data: tampered, signatureBase64: fixture.signature)
)
try JSONEncoder().encode(out).write(to: URL(fileURLWithPath: "\(dir)/swift-out.json"))
