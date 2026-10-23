/**
 * Node half of the Swift <-> Node protocol crypto check (scripts/verify-crypto-interop.sh).
 *   fixture <dir>  write broker keys and a signed request for Swift to verify
 *   check <dir>    verify Swift's signed response and open its sealed credential
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateIdentity, open, requestSigningInput, responseSigningInput, signData, verifyData, type Identity } from '../../src/shared/crypto.ts'

const [mode, dir = '.'] = process.argv.slice(2)
const PLAINTEXT = '{"username":"shopper@example.test","password":"correct-horse"}'

if (mode === 'fixture') {
  const identity = generateIdentity()
  const body = '{"requestId":"req_interop"}'
  const ts = String(Date.now())
  writeFileSync(join(dir, 'identity.json'), JSON.stringify(identity))
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({
    signing: identity.signing.publicKey, sealing: identity.sealing.publicKey, path: '/v1/login', ts, nonce: 'n-interop', body,
    signature: signData(identity.signing.privateKey, requestSigningInput('/v1/login', ts, 'n-interop', body)), context: 'req_interop', plaintext: PLAINTEXT,
  }))
} else if (mode === 'check') {
  const identity = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8')) as Identity
  const out = JSON.parse(readFileSync(join(dir, 'swift-out.json'), 'utf8')) as { helperPub: string; payload: string; signature: string; sealed: { epk: string; box: string }; verifiedRequest: boolean; rejectedTampered: boolean }
  const checks = {
    'swift verified node request signature': out.verifiedRequest,
    'swift rejected tampered request': out.rejectedTampered,
    'node verified swift response signature': verifyData(out.helperPub, responseSigningInput('n-interop', out.payload), out.signature),
    'node opened swift sealed credential': open(identity.sealing.privateKey, 'req_interop', out.sealed) === PLAINTEXT,
  }
  console.table(checks)
  if (Object.values(checks).includes(false)) process.exit(1)
}
