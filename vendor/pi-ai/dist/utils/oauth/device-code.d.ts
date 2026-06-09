export type OAuthDeviceCodePollResult = {
    status: "pending";
} | {
    status: "slow_down";
} | {
    status: "complete";
    accessToken: string;
} | {
    status: "failed";
    message: string;
};
export type OAuthDeviceCodePollOptions = {
    intervalSeconds?: number;
    expiresInSeconds?: number;
    poll: () => Promise<OAuthDeviceCodePollResult>;
    signal?: AbortSignal;
};
export declare function pollOAuthDeviceCodeFlow(options: OAuthDeviceCodePollOptions): Promise<string>;
//# sourceMappingURL=device-code.d.ts.map