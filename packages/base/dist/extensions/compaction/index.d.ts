import type { ExtensionApi, StepContext } from '@goondan/core';
interface CompactionConfig {
    maxTokens?: number;
    minTokens?: number;
    maxChars?: number;
}
interface CompactionState {
    lastAppliedStepId?: string;
}
export declare function register(api: ExtensionApi<CompactionState, CompactionConfig>): Promise<void>;
export declare function compactBlocks(blocks: StepContext['blocks'], maxChars: number): string;
export {};
//# sourceMappingURL=index.d.ts.map