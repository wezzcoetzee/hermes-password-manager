/** Who approves a login for a grant. Set by the operator through the admin CLI only; see ADR 0007. */
export const APPROVAL_MODES = ['prompt', 'chat', 'auto'] as const
export type ApprovalMode = typeof APPROVAL_MODES[number]

export const isApprovalMode = (value: unknown): value is ApprovalMode => APPROVAL_MODES.some((mode) => mode === value)
