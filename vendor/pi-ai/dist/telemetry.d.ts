import { type TelemetrySpan } from "@earendil-works/pi-telemetry";
import type { LazyStreamObserver } from "./api/lazy.ts";
import type { Api, Model } from "./types.ts";
/** Pi-owned request metadata, bounded error status, events, and low-cardinality metrics. */
export declare const AI_TELEMETRY_SCHEMA: {
    readonly version: 1;
    readonly spans: {
        readonly "pi.ai.request": {
            readonly description: "One logical model request, including authentication and provider setup.";
            readonly parents: {
                readonly kind: "any";
            };
            readonly startAttributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly api: {
                    readonly type: "string";
                    readonly description: "API identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
                readonly reasoning: {
                    readonly type: "string";
                    readonly description: "Scalar requested reasoning level.";
                    readonly required: false;
                };
            };
            readonly endAttributes: {
                readonly stop: {
                    readonly type: "string";
                    readonly description: "Normalized stop reason.";
                    readonly values: readonly ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"];
                };
                readonly "usage.input": {
                    readonly type: "number";
                    readonly description: "Uncached input tokens.";
                };
                readonly "usage.output": {
                    readonly type: "number";
                    readonly description: "Output tokens.";
                };
                readonly "usage.cache_read": {
                    readonly type: "number";
                    readonly description: "Cache-read tokens.";
                };
                readonly "usage.cache_write": {
                    readonly type: "number";
                    readonly description: "Cache-write tokens.";
                };
                readonly "cost.total": {
                    readonly type: "number";
                    readonly description: "Total request cost in USD.";
                };
                readonly "response.id": {
                    readonly type: "string";
                    readonly description: "Provider response identifier.";
                    readonly cardinality: "high";
                };
            };
            readonly events: {
                readonly "pi.ai.first_chunk": {
                    readonly description: "First normalized stream event delivered.";
                    readonly attributes: {};
                };
                readonly "pi.ai.block": {
                    readonly description: "A completed content block; content is never recorded.";
                    readonly attributes: {
                        readonly type: {
                            readonly type: "string";
                            readonly description: "Block kind.";
                            readonly values: readonly ["text", "thinking", "tool_call"];
                            readonly required: true;
                        };
                        readonly index: {
                            readonly type: "number";
                            readonly description: "Content block index.";
                            readonly required: true;
                        };
                        readonly chars: {
                            readonly type: "number";
                            readonly description: "UTF-16 character count.";
                            readonly required: true;
                        };
                        readonly tool: {
                            readonly type: "string";
                            readonly description: "Tool name, for tool-call blocks only.";
                            readonly required: false;
                        };
                    };
                };
            };
            readonly status: {
                readonly default: "ok";
                readonly errorWhen: "Stop reason is error: provider_error with at most 500 error-message characters. Aborted stays ok.";
            };
        };
        readonly "pi.ai.poll": {
            readonly parents: {
                readonly kind: "any";
            };
            readonly startAttributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly api: {
                    readonly type: "string";
                    readonly description: "API identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
                readonly reasoning: {
                    readonly type: "string";
                    readonly description: "Scalar requested reasoning level.";
                    readonly required: false;
                };
            };
            readonly endAttributes: {
                readonly stop: {
                    readonly type: "string";
                    readonly description: "Normalized stop reason.";
                    readonly values: readonly ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"];
                };
                readonly "usage.input": {
                    readonly type: "number";
                    readonly description: "Uncached input tokens.";
                };
                readonly "usage.output": {
                    readonly type: "number";
                    readonly description: "Output tokens.";
                };
                readonly "usage.cache_read": {
                    readonly type: "number";
                    readonly description: "Cache-read tokens.";
                };
                readonly "usage.cache_write": {
                    readonly type: "number";
                    readonly description: "Cache-write tokens.";
                };
                readonly "cost.total": {
                    readonly type: "number";
                    readonly description: "Total request cost in USD.";
                };
                readonly "response.id": {
                    readonly type: "string";
                    readonly description: "Provider response identifier.";
                    readonly cardinality: "high";
                };
            };
            readonly events: {
                readonly "pi.ai.first_chunk": {
                    readonly description: "First normalized stream event delivered.";
                    readonly attributes: {};
                };
                readonly "pi.ai.block": {
                    readonly description: "A completed content block; content is never recorded.";
                    readonly attributes: {
                        readonly type: {
                            readonly type: "string";
                            readonly description: "Block kind.";
                            readonly values: readonly ["text", "thinking", "tool_call"];
                            readonly required: true;
                        };
                        readonly index: {
                            readonly type: "number";
                            readonly description: "Content block index.";
                            readonly required: true;
                        };
                        readonly chars: {
                            readonly type: "number";
                            readonly description: "UTF-16 character count.";
                            readonly required: true;
                        };
                        readonly tool: {
                            readonly type: "string";
                            readonly description: "Tool name, for tool-call blocks only.";
                            readonly required: false;
                        };
                    };
                };
            };
            readonly status: {
                readonly default: "ok";
                readonly errorWhen: "Stop reason is error: provider_error with at most 500 error-message characters. Aborted stays ok.";
            };
            readonly description: "One deferred-response poll, not the deferred request's lifetime.";
        };
    };
    readonly metrics: {
        readonly "pi.ai.request.duration": {
            readonly kind: "histogram";
            readonly description: "Logical request or poll duration.";
            readonly unit: "ms";
            readonly attributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
                readonly stop: {
                    readonly type: "string";
                    readonly description: "Normalized stop reason.";
                    readonly values: readonly ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"];
                    readonly required: true;
                };
            };
        };
        readonly "pi.ai.first_chunk.duration": {
            readonly kind: "histogram";
            readonly description: "Time to the first normalized stream event.";
            readonly unit: "ms";
            readonly attributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
            };
        };
        readonly "pi.ai.tokens": {
            readonly kind: "counter";
            readonly description: "Reported model token usage; pending and deferred polls are excluded.";
            readonly unit: "token";
            readonly attributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
                readonly kind: {
                    readonly type: "string";
                    readonly description: "Token usage category.";
                    readonly values: readonly ["input", "output", "cache_read", "cache_write"];
                    readonly required: true;
                };
            };
        };
        readonly "pi.ai.cost": {
            readonly kind: "counter";
            readonly description: "Reported model cost; pending and deferred polls are excluded.";
            readonly unit: "USD";
            readonly attributes: {
                readonly provider: {
                    readonly type: "string";
                    readonly description: "Provider identifier.";
                    readonly required: true;
                };
                readonly model: {
                    readonly type: "string";
                    readonly description: "Requested model identifier.";
                    readonly required: true;
                };
            };
        };
    };
};
export declare function observeModelRequest(requestedModel: Model<Api>, options: {
    telemetry?: TelemetrySpan;
    reasoning?: unknown;
} | undefined, poll: boolean): LazyStreamObserver;
//# sourceMappingURL=telemetry.d.ts.map