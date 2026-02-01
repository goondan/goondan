import type { ToolContext } from '@goondan/core';
interface SlackPostMessageInput {
    channel: string;
    text: string;
    threadTs?: string;
    scopes?: string[];
}
export declare const handlers: {
    'slack.postMessage': (ctx: ToolContext, input: SlackPostMessageInput) => Promise<any>;
};
export {};
//# sourceMappingURL=index.d.ts.map