import { parseConversationKey } from '../../../../src/channels/shared/conversation/describe.mjs';

/**
 * Identity events for conversation bindings.
 *
 * `dsh-im/session-pre-bind` is announced the moment a conversation points at a
 * session. It runs synchronously and before the Session exists, so a subscriber
 * holds the identity while the first system prompt is assembled.
 *
 * `dsh-im/session-unbind` is announced when a conversation stops pointing at a
 * session: it was switched to another one, or the binding was cleared. Without
 * it a subscriber can only notice that *some* session was bound later, and its
 * own session->identity state keeps claiming a conversation it no longer owns.
 *
 * Both events carry the same conversation fields, so a subscriber handles them
 * symmetrically.
 */
export function createBindingAnnouncer({
  channel,
  emit,
  authorsOf = () => null,
  parse = parseConversationKey,
} = {}) {
  if (typeof emit !== 'function') throw new TypeError('emit is required');

  const conversationFields = (conversationKey) => {
    const parsed = parse(conversationKey, { channel });
    return {
      channel,
      conversationKey,
      chatType: parsed?.chatType ?? null,
      chatId: parsed?.chatId ?? null,
      threadId: parsed?.threadId ?? null,
      senderId: parsed?.senderId ?? null,
    };
  };

  // A subscriber that throws must not break the message being handled, so every
  // announce swallows its own failure.
  const announce = (event, payload) => {
    try {
      emit(event, Object.freeze(payload));
    } catch {
      // ignore a subscriber's failure
    }
  };

  const bind = (botId, conversationKey, sessionId) => {
    try {
      const authors = authorsOf(botId);
      const author = authors?.[conversationKey] ?? null;
      const fields = conversationFields(conversationKey);
      announce('dsh-im/session-pre-bind', {
        ...fields,
        botId,
        sessionId,
        senderId: author?.senderId ?? fields.senderId,
        senderName: author?.senderName ?? null,
      });
    } catch {
      // ignore a malformed conversation key or author snapshot
    }
  };

  const unbind = (botId, conversationKey, sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return;
    try {
      announce('dsh-im/session-unbind', {
        ...conversationFields(conversationKey),
        botId,
        sessionId,
      });
    } catch {
      // ignore a malformed conversation key
    }
  };

  const previousSession = (state, key) => (typeof state.sessionFor === 'function'
    ? state.sessionFor(key)
    : null);

  /**
   * Wrap one bot's state store so every committed binding change is announced.
   * A refused write (`false`) announces nothing, and a write that repeats the
   * current session is not an unbind: the conversation never left it.
   */
  const wrap = (botId, state) => {
    if (state === null || typeof state !== 'object' || state.__announces === true) return state;
    const setSession = state.setSession;
    if (typeof setSession !== 'function') return state;

    state.setSession = async (key, sessionId) => {
      const previous = previousSession(state, key);
      const result = await setSession.call(state, key, sessionId);
      if (result === false) return result;
      if (previous !== null && previous !== sessionId) unbind(botId, key, previous);
      bind(botId, key, sessionId);
      return result;
    };

    if (typeof state.clearSession === 'function') {
      const clearSession = state.clearSession;
      state.clearSession = async (key) => {
        const previous = previousSession(state, key);
        const result = await clearSession.call(state, key);
        unbind(botId, key, previous);
        return result;
      };
    }

    if (typeof state.clearSessions === 'function') {
      const clearSessions = state.clearSessions;
      state.clearSessions = async () => {
        const bindings = typeof state.snapshot === 'function'
          ? state.snapshot()?.sessions ?? null
          : null;
        const result = await clearSessions.call(state);
        for (const [key, sessionId] of Object.entries(bindings ?? {})) {
          unbind(botId, key, sessionId);
        }
        return result;
      };
    }

    state.__announces = true;
    return state;
  };

  return { bind, unbind, wrap };
}
