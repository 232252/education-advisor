// =============================================================
// _shared/acl — DM/group allow/deny/pending gate (QwenPaw ACL)
// =============================================================

export type AclMode = 'open' | 'allowlist' | 'deny'
export type AclDecision = 'allow' | 'deny' | 'pending'

export interface AclPolicy {
  dm: AclMode
  group: AclMode
  /** Explicit allow list (sender or chat ids) */
  allowFrom: string[]
  /** Explicit deny list (always blocks) */
  denyFrom?: string[]
  /** Pending approval ids (treated as deny with pending reason) */
  pendingFrom?: string[]
  requireMention?: boolean
}

export interface AclCheckInput {
  chatType: 'p2p' | 'group'
  senderId: string
  chatId?: string
  /** Whether the bot was @mentioned (group) */
  mentioned?: boolean
}

export interface AclCheckResult {
  decision: AclDecision
  reason?: string
}

function norm(id: string): string {
  return id.trim().toLowerCase()
}

function inList(list: string[] | undefined, id: string): boolean {
  if (!list?.length) return false
  const n = norm(id)
  return list.some((x) => norm(x) === n)
}

/**
 * Evaluate ACL for an inbound message.
 * Deny list wins; pending is deny-with-pending; allowlist requires match.
 */
export function checkAcl(policy: AclPolicy, input: AclCheckInput): AclCheckResult {
  const { senderId, chatId, chatType, mentioned } = input
  if (inList(policy.denyFrom, senderId) || (chatId && inList(policy.denyFrom, chatId))) {
    return { decision: 'deny', reason: 'sender_denied' }
  }
  if (inList(policy.pendingFrom, senderId)) {
    return { decision: 'pending', reason: 'awaiting_approval' }
  }

  const mode = chatType === 'p2p' ? policy.dm : policy.group
  if (mode === 'open') {
    if (chatType === 'group' && policy.requireMention && !mentioned) {
      return { decision: 'deny', reason: 'mention_required' }
    }
    return { decision: 'allow' }
  }
  if (mode === 'deny') {
    return { decision: 'deny', reason: 'chat_type_denied' }
  }
  // allowlist
  const allowed =
    inList(policy.allowFrom, senderId) || (chatId ? inList(policy.allowFrom, chatId) : false)
  if (!allowed) {
    return { decision: 'deny', reason: 'not_in_allowlist' }
  }
  if (chatType === 'group' && policy.requireMention && !mentioned) {
    return { decision: 'deny', reason: 'mention_required' }
  }
  return { decision: 'allow' }
}

export function policyFromConfig(config: Record<string, unknown>): AclPolicy {
  const parseList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean)
    if (typeof v === 'string') {
      return v
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  }
  const mode = (v: unknown, fallback: AclMode): AclMode => {
    const s = String(v ?? fallback)
    if (s === 'open' || s === 'allowlist' || s === 'deny') return s
    return fallback
  }
  return {
    dm: mode(config.aclDm ?? config.dmPolicy, 'open'),
    group: mode(config.aclGroup ?? config.groupPolicy, 'open'),
    allowFrom: parseList(config.allowFrom),
    denyFrom: parseList(config.denyFrom),
    pendingFrom: parseList(config.pendingFrom),
    requireMention: Boolean(config.requireMention),
  }
}
