/**
 * Final action for current state at one address:
 * - copy: emit the current value in the destination;
 * - exclude: omit it from the destination;
 * - reconstruct: do not copy the row because lane handling emits a coherent replacement.
 */
export type ForkDisposition = "copy" | "exclude" | "reconstruct";
/** Decide the final fork action for one current scalar or list address. */
export declare function classifyForkAddress(address: {
    readonly namespace: string;
    readonly key: string;
}, scope: "branch" | "tree", isEntryCopied: (entryId: string) => boolean): ForkDisposition;
//# sourceMappingURL=fork-policy.d.ts.map