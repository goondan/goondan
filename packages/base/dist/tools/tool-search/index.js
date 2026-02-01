export const handlers = {
    'toolSearch.find': async (ctx, input) => {
        const payload = input;
        const query = String(payload.query ?? '').toLowerCase();
        const limit = payload.limit ?? 5;
        const autoAdd = Boolean(payload.autoAdd);
        const toolCatalog = ctx.toolCatalog || [];
        const matches = toolCatalog
            .map((tool) => {
            const name = String(tool.name || '');
            const description = String(tool.description || '');
            const score = scoreMatch(name, description, query);
            return { tool, name, score };
        })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        const proposed = [];
        if (autoAdd) {
            for (const match of matches) {
                const toolRef = match.tool.tool?.metadata?.name;
                if (!toolRef)
                    continue;
                if (isToolAlreadyEnabled(ctx, toolRef))
                    continue;
                await proposeToolPatch(ctx, toolRef, `toolSearch.find:${query}`);
                proposed.push(toolRef);
            }
        }
        return {
            query,
            matches: matches.map((item) => ({ name: item.name, score: item.score })),
            proposed,
        };
    },
};
function scoreMatch(name, description, query) {
    if (!query)
        return 0;
    let score = 0;
    if (name.toLowerCase().includes(query))
        score += 2;
    if (description.toLowerCase().includes(query))
        score += 1;
    return score;
}
function isToolAlreadyEnabled(ctx, toolName) {
    const tools = ctx.agent.spec?.tools || [];
    return tools.some((tool) => {
        if (typeof tool === 'string') {
            return tool === toolName || tool.endsWith(`/${toolName}`);
        }
        if (tool && typeof tool === 'object' && 'selector' in tool) {
            return false;
        }
        const refName = tool.name || tool.metadata?.name;
        return refName === toolName;
    });
}
async function proposeToolPatch(ctx, toolName, reason) {
    await ctx.liveConfig.proposePatch({
        scope: 'agent',
        applyAt: 'step.config',
        patch: {
            type: 'json6902',
            ops: [{ op: 'add', path: '/spec/tools/-', value: { kind: 'Tool', name: toolName } }],
        },
        source: { type: 'tool', name: 'toolSearch.find' },
        reason,
    });
}
//# sourceMappingURL=index.js.map