import type { Usage } from "@earendil-works/pi-ai";
import type { Context } from "../../context.ts";
import type { FileSystem } from "../../types.ts";
import type { CommittedWrite } from "../commit.ts";
import { type LegacyV3SessionHeader } from "./codec.ts";
import { type JsonlSessionMetadata, type JsonlStorageHeader } from "./types.ts";
export interface NormalizedLegacyV3Records {
    writes: CommittedWrite[];
    importedUsage: Usage;
    nextSeq: number;
}
type JsonlSessionMetadataBase = Omit<JsonlSessionMetadata, "path" | "modifiedAt">;
export declare function metadataFromLegacyV3Header(fileSystem: FileSystem, header: LegacyV3SessionHeader, context: Context): Promise<JsonlSessionMetadataBase>;
export declare function normalizeLegacyV3Header(fileSystem: FileSystem, header: LegacyV3SessionHeader, context: Context): Promise<JsonlStorageHeader>;
/** Normalize the currently supported v3 records without touching their source file. */
export declare function normalizeLegacyV3Records(recordLines: readonly string[]): NormalizedLegacyV3Records;
export {};
//# sourceMappingURL=legacy-v3.d.ts.map