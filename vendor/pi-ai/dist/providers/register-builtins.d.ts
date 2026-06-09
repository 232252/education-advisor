import type { AssistantMessageEvent, Context, Model, SimpleStreamOptions, StreamFunction } from "../types.ts";
import type { BedrockOptions } from "./amazon-bedrock.ts";
import type { AnthropicOptions } from "./anthropic.ts";
import type { AzureOpenAIResponsesOptions } from "./azure-openai-responses.ts";
import type { GoogleOptions } from "./google.ts";
import type { GoogleVertexOptions } from "./google-vertex.ts";
import type { MistralOptions } from "./mistral.ts";
import type { OpenAICodexResponsesOptions } from "./openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./openai-completions.ts";
import type { OpenAIResponsesOptions } from "./openai-responses.ts";
interface BedrockProviderModule {
    streamBedrock: (model: Model<"bedrock-converse-stream">, context: Context, options?: BedrockOptions) => AsyncIterable<AssistantMessageEvent>;
    streamSimpleBedrock: (model: Model<"bedrock-converse-stream">, context: Context, options?: SimpleStreamOptions) => AsyncIterable<AssistantMessageEvent>;
}
export declare function setBedrockProviderModule(module: BedrockProviderModule): void;
export declare const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions>;
export declare const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions>;
export declare const streamAzureOpenAIResponses: StreamFunction<"azure-openai-responses", AzureOpenAIResponsesOptions>;
export declare const streamSimpleAzureOpenAIResponses: StreamFunction<"azure-openai-responses", SimpleStreamOptions>;
export declare const streamGoogle: StreamFunction<"google-generative-ai", GoogleOptions>;
export declare const streamSimpleGoogle: StreamFunction<"google-generative-ai", SimpleStreamOptions>;
export declare const streamGoogleVertex: StreamFunction<"google-vertex", GoogleVertexOptions>;
export declare const streamSimpleGoogleVertex: StreamFunction<"google-vertex", SimpleStreamOptions>;
export declare const streamMistral: StreamFunction<"mistral-conversations", MistralOptions>;
export declare const streamSimpleMistral: StreamFunction<"mistral-conversations", SimpleStreamOptions>;
export declare const streamOpenAICodexResponses: StreamFunction<"openai-codex-responses", OpenAICodexResponsesOptions>;
export declare const streamSimpleOpenAICodexResponses: StreamFunction<"openai-codex-responses", SimpleStreamOptions>;
export declare const streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions>;
export declare const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions>;
export declare const streamOpenAIResponses: StreamFunction<"openai-responses", OpenAIResponsesOptions>;
export declare const streamSimpleOpenAIResponses: StreamFunction<"openai-responses", SimpleStreamOptions>;
export declare function registerBuiltInApiProviders(): void;
export declare function resetApiProviders(): void;
export {};
//# sourceMappingURL=register-builtins.d.ts.map