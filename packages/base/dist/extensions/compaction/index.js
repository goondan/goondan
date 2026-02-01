export async function register(api) {
    const state = api.extState();
    const config = api.extension.spec?.config || {};
    const maxTokens = config.maxTokens ?? 2000;
    const minTokens = config.minTokens ?? 800;
    const maxChars = config.maxChars ?? 2000;
    api.pipelines.mutate('step.post', async (ctx) => {
        if (!ctx.step)
            return ctx;
        const usage = readUsage(ctx.step.llmResult?.meta);
        if (!usage)
            return ctx;
        if (state.lastAppliedStepId === ctx.step.id)
            return ctx;
        if (usage.totalTokens > maxTokens || usage.totalTokens > minTokens) {
            const summary = compactBlocks(ctx.blocks, maxChars);
            ctx.turn.metadata = ctx.turn.metadata || {};
            ctx.turn.metadata.compaction = {
                summary,
                appliedAt: ctx.step.id,
                usage,
            };
            state.lastAppliedStepId = ctx.step.id;
        }
        return ctx;
    });
    api.pipelines.mutate('step.blocks', async (ctx) => {
        const compaction = ctx.turn.metadata?.compaction;
        if (!compaction?.summary)
            return ctx;
        const blocks = [];
        const sourceBlocks = ctx.blocks || [];
        const system = sourceBlocks.find((block) => block.type === 'system');
        if (system)
            blocks.push(system);
        blocks.push({ type: 'compacted', content: compaction.summary });
        const input = sourceBlocks.find((block) => block.type === 'input');
        if (input)
            blocks.push(input);
        return { ...ctx, blocks };
    });
}
function readUsage(meta) {
    const usage = meta?.usage;
    if (!usage?.totalTokens)
        return null;
    return { totalTokens: usage.totalTokens };
}
export function compactBlocks(blocks, maxChars) {
    const sourceBlocks = blocks || [];
    const text = sourceBlocks
        .map((block) => {
        if (typeof block.content === 'string')
            return block.content;
        if (Array.isArray(block.items))
            return JSON.stringify(block.items);
        return '';
    })
        .filter(Boolean)
        .join('\n\n');
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}
//# sourceMappingURL=index.js.map