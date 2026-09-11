export declare function retryDelay(baseDelayMs: number, attempt: number): number;
export declare function retryNotBefore(baseDelayMs: number, attempt: number, now?: number): number;
export declare function waitUntil(notBefore: number, signal: AbortSignal): Promise<void>;
//# sourceMappingURL=retry.d.ts.map