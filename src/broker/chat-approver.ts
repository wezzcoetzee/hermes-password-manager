/**
 * Login approval in chat. Each provider fetches the decision itself and counts it only when it comes
 * from the configured user. No agent tool reaches this path, so the agent cannot approve its own
 * request. Telegram uses AgentVault's own bot; Discord may reuse Hermes' bot in a channel, where an
 * edited prompt is denied. See ADR 0007, ADR 0008 and ADR 0009.
 */
import type { Decision, LoginRequest } from '../shared/helper-protocol.ts'

export interface ChatApprover { approveLogin(req: LoginRequest): Promise<Decision> }

/** Operator-chosen account id instead of the username, so no PII is sent to the chat provider. */
export const approvalPrompt = (req: LoginRequest) => [
  `AgentVault: ${req.agent} wants to sign in`,
  `Site: ${req.site.name} (${req.site.origin})`,
  `Account: ${req.account.id}`,
  `Session: ${req.durationMinutes} minutes`,
  `Request: ${req.requestId}`,
].join('\n')

export const approvalOutcome: Record<Decision, string> = { approved: 'Approved once.', denied: 'Denied.', unavailable: 'Expired. Nothing was approved.' }
