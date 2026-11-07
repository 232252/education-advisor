import type { Api, AssistantMessage, AssistantMessageEvent, Model, ProviderStreams } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
/** Synchronous, read-only observation of the stream's existing forwarding path. */
export interface LazyStreamObserver {
    onEvent?(event: AssistantMessageEvent): void;
    onResult?(result: AssistantMessage | undefined): void;
}
/**
 * Returns a stream synchronously while running async setup (auth resolution,
 * lazy module loading) behind it. Setup failures terminate the stream with an
 * error event.
 */
export declare function lazyStream(model: Model<Api>, setup: () => Promise<AsyncIterable<AssistantMessageEvent>>, observer?: LazyStreamObserver): AssistantMessageEventStream;
/**
 * Wraps a dynamically imported API implementation module as `ProviderStreams`.
 * The module loads on first stream call; the host's import cache deduplicates
 * loads. Load failures terminate the returned stream with an error event.
 */
export interface LazyApiCapabilities {
    fetchDeferred?: boolean;
    cancelDeferred?: boolean;
}
export declare function lazyApi(load: () => Promise<ProviderStreams>, capabilities?: LazyApiCapabilities): ProviderStreams;
//# sourceMappingURL=lazy.d.ts.map