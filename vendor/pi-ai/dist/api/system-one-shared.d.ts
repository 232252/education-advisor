import type { ClassifierApi, ClassifierContext, ClassifierModel, ClassifierOptions, ClassifierResult, SystemOneCompat } from "../types.ts";
/** A System One image asset: base64 file bytes, referenced by its name from the state. */
interface SystemOneImageAsset {
    type: "image";
    format: "png" | "jpeg";
    data_base64: string;
}
/** TypeSafe System One request body without the transport-specific envelope. */
export interface SystemOneWireRequest {
    /** The context state, or with images a list of the images or their asset names followed by the state. */
    state: unknown;
    questions: Record<string, unknown>;
    /** Images as System One assets, keyed by the names the state references. */
    assets?: Record<string, SystemOneImageAsset>;
    /** Images as data URLs, Clef's extension to System One. */
    images?: string[];
}
/**
 * How a service takes images (`SystemOneCompat.imageInput`):
 * - `assets`: TypeSafe's `assets` map, `{ "<image-1>": { type: "image", format, data_base64 } }`,
 *   with the names placed before the state: `state: ["<image-1>", state]`. PNG and JPEG only.
 * - `images`: Clef's `images` list of data URLs, which the model reads before the state.
 *   PNG, JPEG, and WebP, at most four.
 * - `state-image-urls`: OpenRouter's form, data URL parts placed before the state:
 *   `state: [{ type: "image_url", image_url: { url } }, state]`. OpenRouter accepts this for every
 *   model, and drops `assets` silently.
 */
export type SystemOneImageInput = NonNullable<SystemOneCompat["imageInput"]>;
/** System One compatibility settings with every field resolved. */
export type ResolvedSystemOneCompat = Required<SystemOneCompat>;
/** Differences between services that serve System One models. */
export interface SystemOneTransport {
    /** Classifier API implemented by this transport. */
    api: ClassifierApi;
    /** Service name used in error messages. */
    label: string;
    /** Compatibility settings for models that do not set them in `compat`. */
    detectCompat(model: ClassifierModel<ClassifierApi>): ResolvedSystemOneCompat;
    /** Absolute request URL. */
    url(model: ClassifierModel<ClassifierApi>): URL;
    /** Wraps the System One request in the service's request envelope. */
    payload(model: ClassifierModel<ClassifierApi>, request: SystemOneWireRequest): unknown;
    /** Extracts the System One output (`{ answers, usage }`) from the service's response envelope. */
    output(body: unknown): Record<string, unknown>;
}
/** Runs one System One classification over the given transport. */
export declare function classifySystemOne(transport: SystemOneTransport, model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options: ClassifierOptions | undefined): Promise<ClassifierResult>;
export {};
//# sourceMappingURL=system-one-shared.d.ts.map