/** Decide the final fork action for one current scalar or list address. */
export function classifyForkAddress(address, scope, isEntryCopied) {
    switch (address.namespace) {
        case "pi.session.name":
            return "copy";
        case "pi.entry.label":
            return isEntryCopied(address.key) ? "copy" : "exclude";
        case "pi.branch.tip":
        case "pi.lane.config":
        case "pi.lane.state":
            return "reconstruct";
        case "pi.result":
            return "exclude";
    }
    if (address.namespace.startsWith("pi.op.") || address.namespace.startsWith("pi.pending."))
        return "exclude";
    if (address.namespace === "pi" || address.namespace.startsWith("pi.")) {
        throw new Error(`Unknown reserved fork namespace: ${address.namespace}`);
    }
    return scope === "tree" ? "copy" : "exclude";
}
//# sourceMappingURL=fork-policy.js.map