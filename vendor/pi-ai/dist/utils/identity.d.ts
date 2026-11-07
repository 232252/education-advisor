import type { Models, MutableModels } from "../models.ts";
/**
 * The `User-Agent` sent to providers:
 * - `"detailed"`: `pi/<version> (<platform>; <runtime>/<runtime version>; <arch>)`, or `pi/<version> (browser)`
 *   outside Node.js and Bun.
 * - `"short"`: `pi`.
 * - `{ custom }`: the given value.
 */
export type UserAgentMode = "short" | "detailed" | {
    custom: string;
};
/** Who requests are attributed to. `getAttributionHeaders()` maps the fields to each provider's headers. */
export interface ClientAttribution {
    /** App name: OpenRouter app title, NVIDIA invoke origin (first letter upper-cased), OpenCode client. */
    name: string;
    /** App URL: OpenRouter `HTTP-Referer`, the app's identity in OpenRouter's rankings, grouped by origin. */
    url: string;
    /** App categories, e.g. `["cli-agent"]`: OpenRouter `X-OpenRouter-Categories`, comma-separated. */
    categories?: string[];
}
/** pi's attribution, used by pi-agent-core, pi-durable, and the coding agent. */
export declare const PI_ATTRIBUTION: ClientAttribution;
/**
 * How pi-ai identifies the calling app to providers. Every field is optional; absent fields use pi-ai's defaults:
 * a detailed `User-Agent` with pi-ai's version and no attribution headers. Plain JSON, so it can be persisted.
 */
export interface ClientIdentity {
    /** Default: `"detailed"`. */
    userAgent?: UserAgentMode;
    /** Provider attribution headers. Absent or `null`: none; `null` also turns off attribution set by a merged identity. */
    attribution?: ClientAttribution | null;
    /** Version in the detailed `User-Agent`. Default: the pi-ai version. */
    version?: string;
}
/** The provider and endpoint a request goes to. */
export interface ClientIdentityTarget {
    readonly provider: string;
    readonly baseUrl: string;
}
/** Merge identities field by field; later sources win and undefined fields are skipped. */
export declare function mergeClientIdentity(...sources: (ClientIdentity | undefined)[]): ClientIdentity | undefined;
/** The version in the detailed `User-Agent`. */
export declare function getClientVersion(identity?: ClientIdentity): string;
/** The `User-Agent` value of an identity. */
export declare function formatUserAgent(identity?: ClientIdentity): string;
/** Provider attribution headers of an identity for a request target. Empty when attribution is off. */
export declare function getAttributionHeaders(target: ClientIdentityTarget, identity?: ClientIdentity): Record<string, string>;
/**
 * OpenCode's per-conversation routing header for requests to OpenCode, including custom providers pointing at it.
 * Undefined without a session or for other targets.
 */
export declare function getOpenCodeSessionHeaders(target: ClientIdentityTarget, sessionId: string | undefined): Record<string, string> | undefined;
/**
 * Default headers an identity adds to a request: `User-Agent` and provider attribution. APIs apply them below model,
 * provider, and request headers, so configured headers override them and `null` request headers remove them.
 */
export declare function getIdentityHeaders(target: ClientIdentityTarget, identity?: ClientIdentity): Record<string, string>;
/**
 * `models` with `identity` as the default identity of its requests: a request's `identity` overrides it field by
 * field, and it overrides the identity `models` was created with. Everything else is delegated unchanged; a
 * `MutableModels` stays mutable.
 */
export declare function withClientIdentity(models: MutableModels, identity: ClientIdentity): MutableModels;
export declare function withClientIdentity(models: Models, identity: ClientIdentity): Models;
//# sourceMappingURL=identity.d.ts.map