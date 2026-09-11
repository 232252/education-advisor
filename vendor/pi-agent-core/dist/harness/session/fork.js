import { classifyForkAddress } from "./fork-policy.js";
import { branchTip, laneConfig, laneState, value } from "./values.js";
function storedValuesInNamespace(values, address) {
    return values.filter((stored) => stored.address.namespace === address.namespace);
}
function findStoredValue(values, address) {
    return values.find((stored) => stored.address.namespace === address.namespace && stored.address.key === address.key);
}
/** Build the complete logical state for a forked destination session. */
export function createForkSnapshot(source, options) {
    const sourceEntries = new Map(source.entries.map((entry) => [entry.id, entry]));
    const sourceTips = storedValuesInNamespace(source.scalarValues, branchTip(""));
    validateForkSourceSnapshot(source, sourceEntries, sourceTips, options);
    const { entryIds, destinationTips } = selectForkContents(sourceEntries, sourceTips, options);
    const entries = new Map();
    for (const id of entryIds)
        entries.set(id, sourceEntries.get(id));
    const scalarValues = [];
    let nextSeq = Math.max(0, ...[...entries.values()].map((entry) => entry.seq)) + 1;
    const store = (address, storedValue) => {
        scalarValues.push({
            address: value(address.namespace, address.key),
            value: storedValue,
            seq: nextSeq++,
        });
    };
    for (const [branch, tipId] of destinationTips) {
        const configuration = findStoredValue(source.scalarValues, laneConfig(branch));
        store(branchTip(branch), tipId);
        if (configuration !== undefined) {
            store(laneConfig(branch), configuration.value);
            store(laneState(branch), { currentOperationId: null, lastOperationId: null, inbox: [] });
        }
    }
    for (const stored of source.scalarValues) {
        switch (classifyForkAddress(stored.address, options.scope, (entryId) => entryIds.has(entryId))) {
            case "copy":
                store(stored.address, stored.value);
                break;
            case "exclude":
            case "reconstruct":
                break;
        }
    }
    return { entries, scalarValues, nextSeq };
}
export function forkSnapshotWrites(snapshot) {
    const writes = [];
    for (const entry of snapshot.entries.values())
        writes.push({ kind: "entry", ...entry });
    for (const stored of snapshot.scalarValues) {
        writes.push({
            kind: "value",
            op: "set",
            seq: stored.seq,
            namespace: stored.address.namespace,
            key: stored.address.key,
            value: stored.value,
        });
    }
    return writes.sort((left, right) => left.seq - right.seq);
}
function selectForkContents(sourceEntries, sourceTips, options) {
    const entryIds = new Set();
    const destinationTips = new Map();
    if (options.scope === "tree") {
        for (const id of sourceEntries.keys())
            entryIds.add(id);
        for (const stored of sourceTips)
            destinationTips.set(stored.address.key, stored.value);
    }
    else {
        const sourceTip = sourceTips.find((stored) => stored.address.key === options.branch);
        if (sourceTip === undefined)
            throw new Error(`Unknown source branch: ${options.branch}`);
        const requested = options.entryId ?? sourceTip.value;
        let found = requested === null;
        let tipId = null;
        let entryId = sourceTip.value;
        while (entryId !== null) {
            const entry = sourceEntries.get(entryId);
            if (entry === undefined)
                throw new Error(`Corrupt source branch: missing parent ${entryId}`);
            if (entry.id === requested) {
                found = true;
                tipId = options.position === "before" ? entry.parentId : entry.id;
                if (options.position !== "before")
                    entryIds.add(entry.id);
            }
            else if (found) {
                entryIds.add(entry.id);
            }
            entryId = entry.parentId;
        }
        if (!found) {
            throw new Error(`Fork entry ${requested} is not on source branch ${JSON.stringify(options.branch)}`);
        }
        destinationTips.set(options.branch, tipId);
    }
    return { entryIds, destinationTips };
}
function validateForkSourceSnapshot(source, sourceEntries, sourceTips, options) {
    const sourceTipKeys = new Set(sourceTips.map((stored) => stored.address.key));
    for (const stored of source.scalarValues) {
        if ((stored.address.namespace === laneConfig("").namespace ||
            stored.address.namespace === laneState("").namespace) &&
            !sourceTipKeys.has(stored.address.key)) {
            throw new Error(`Source session branch ${JSON.stringify(stored.address.key)} is missing branch.tip`);
        }
    }
    for (const tip of sourceTips) {
        const configuration = findStoredValue(source.scalarValues, laneConfig(tip.address.key));
        const state = findStoredValue(source.scalarValues, laneState(tip.address.key));
        if ((configuration === undefined) !== (state === undefined)) {
            throw new Error(`Source session branch ${JSON.stringify(tip.address.key)} has incomplete lane state`);
        }
        if (options.scope === "branch" && tip.address.key === options.branch && configuration === undefined) {
            throw new Error(`Source branch ${JSON.stringify(options.branch)} is not a configured AgentLane`);
        }
        if ((source.entriesComplete !== false || options.scope === "tree") &&
            tip.value !== null &&
            !sourceEntries.has(tip.value)) {
            throw new Error(`Source session branch ${JSON.stringify(tip.address.key)} has an unknown tip`);
        }
    }
}
//# sourceMappingURL=fork.js.map