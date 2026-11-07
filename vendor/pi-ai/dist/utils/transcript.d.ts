import type { Context, Message, SystemMessage, Tool, ToolReference, TranscriptContext } from "../types.ts";
export type { TranscriptContext } from "../types.ts";
/**
 * Build the leading system message for a prompt and tool set. Returns undefined when
 * both are empty, so an empty transcript stays empty.
 */
export declare function createInitialSystemMessage(systemPrompt: string | undefined, tools: Tool[] | undefined): SystemMessage | undefined;
/**
 * Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
 * This is the only entry point that produces a {@link TranscriptContext}; every
 * provider-facing function expects the result.
 */
export declare function normalizeContext(context: Context): TranscriptContext;
/**
 * Any message list. The replay helpers only read entries whose role is `"system"`, so
 * agent transcripts that carry custom message roles can be passed without filtering.
 */
export type TranscriptMessages = readonly {
    role: string;
}[];
/** Return the leading system message, if the transcript starts with one. */
export declare function getInitialSystemMessage(messages: TranscriptMessages): SystemMessage | undefined;
/** Drop the leading system message for APIs that carry the prompt outside the message list. */
export declare function withoutInitialSystemMessage(messages: Message[]): Message[];
/** Resolve the tools available after applying every transcript delta in order. */
export declare function getCurrentTools(messages: TranscriptMessages): Tool[];
/**
 * Replay every system message into one leading system message holding the current
 * prompt and tools. Later `content` is appended to the base prompt, `sections` are
 * patched by name, and tools are resolved with {@link getCurrentTools}.
 */
export declare function getCurrentSystemMessage(messages: TranscriptMessages): SystemMessage | undefined;
/** Render the current system prompt text after replaying every system message. */
export declare function getCurrentSystemPrompt(messages: TranscriptMessages): string;
/**
 * Rebuild the transcript for APIs without mid-conversation system messages: the replayed
 * system message leads, and every later system message is dropped.
 */
export declare function collapseSystemMessages(context: TranscriptContext): TranscriptContext;
/** Keep later system messages in place when the model accepts them; otherwise collapse them. */
export declare function resolveTranscript(context: TranscriptContext, supportsMidConvoSystemMessages: boolean | undefined): TranscriptContext;
/** Strip executable and display-only fields from a tool before transcript comparison or persistence. */
export declare function toToolDeclaration(tool: Tool): Tool;
/**
 * Whether two tools declare the same interface to the model.
 *
 * Both sides go through {@link toToolDeclaration} first: its JSON round-trip drops the
 * typebox symbol keys and `undefined` fields that a structural comparison would see, and
 * builds both objects with the same key order, so comparing the serialized declarations
 * is exact. This avoids a deep-equal dependency in a browser-safe package.
 */
export declare function declarationsEqual(left: Tool, right: Tool): boolean;
export interface ToolStateChanges {
    toolsAdded: Tool[];
    toolsRemoved: ToolReference[];
}
/** Compare two complete tool states. A changed definition is a removal followed by an addition. */
export declare function getToolStateChanges(previous: readonly Tool[], current: readonly Tool[]): ToolStateChanges;
/** Every definition referenced by transcript tool state, in first-declaration order. */
export declare function getDeclaredTools(messages: TranscriptMessages): Tool[];
/**
 * Whether a tool name was declared twice with different definitions. A transport that can
 * only reference previously declared tools by name cannot replay such a history.
 *
 * @deprecated No built-in transport needs this anymore: Anthropic expresses redefinitions with
 * inline `tool_definition` blocks. Kept for API compatibility and will be removed in a future release.
 */
export declare function hasToolRedefinitions(messages: TranscriptMessages): boolean;
/** Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay. */
export declare function hasNonAdditiveToolChanges(messages: TranscriptMessages): boolean;
/**
 * How a transport can express tool changes after the first request.
 *
 * - `"none"`: only the top-level tool list exists; it always holds the current tools.
 * - `"additions"`: tools can be added at a later message, but not removed or redefined.
 * - `"changes"`: every tool, including the initial ones, is declared in place, and a later
 *   declaration under the same name replaces the earlier one. Removals are not expressible on
 *   the wire, so the transport announces them as text and the removed tools stay declared.
 */
export type TranscriptToolSupport = "none" | "additions" | "changes";
export interface TranscriptTools {
    /** Tools sent in the top-level request field. */
    requestTools: Tool[];
    /**
     * Number of leading system messages whose tool changes `requestTools` already holds. Every
     * later system message carries its own tool changes in place.
     */
    foldedSystemMessages: number;
}
/**
 * Split tool declarations between the top-level request field and in-place changes.
 *
 * With `"changes"`, the top-level list stays empty and every system message, including the
 * leading one, declares its tools in place: an in-place declaration can replace an earlier
 * in-place one, but not a top-level one. With `"additions"`, a removal or redefinition cannot be
 * expressed in place, so the top-level list becomes the tool state after the last such change;
 * later additions stay anchored, and the cached prefix is invalidated once per removal instead
 * of on every later addition. With `"none"`, the top-level list is the current tool set.
 */
export declare function resolveTranscriptTools(messages: TranscriptMessages, support: TranscriptToolSupport): TranscriptTools;
//# sourceMappingURL=transcript.d.ts.map