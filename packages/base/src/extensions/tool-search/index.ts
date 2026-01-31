interface ToolSearchInput {
  query: string;
  limit?: number;
  autoAdd?: boolean;
}

export async function register(api: Record<string, unknown>): Promise<void> {
  const tools = api.tools as { register?: (toolDef: { name: string; handler: (ctx: Record<string, unknown>, input: Record<string, unknown>) => Promise<unknown> }) => void };
  if (!tools?.register) return;

  tools.register({
    name: 'toolSearch.find',
    handler: async (ctx, input) => {
      const payload = input as Partial<ToolSearchInput>;
      const query = String(payload.query ?? '').toLowerCase();
      const limit = payload.limit ?? 5;
      const autoAdd = Boolean(payload.autoAdd);
      const toolCatalog = (ctx.toolCatalog as Array<Record<string, unknown>> | undefined) || [];

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

      const proposed: string[] = [];
      if (autoAdd) {
        for (const match of matches) {
          const toolRef = (match.tool.tool as { metadata?: { name?: string } } | null)?.metadata?.name;
          if (!toolRef) continue;
          if (isToolAlreadyEnabled(ctx, toolRef)) continue;
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
  });
}

function scoreMatch(name: string, description: string, query: string): number {
  if (!query) return 0;
  let score = 0;
  if (name.toLowerCase().includes(query)) score += 2;
  if (description.toLowerCase().includes(query)) score += 1;
  return score;
}

function isToolAlreadyEnabled(ctx: Record<string, unknown>, toolName: string): boolean {
  const agent = ctx.agent as { spec?: { tools?: Array<Record<string, unknown>> } } | undefined;
  const tools = agent?.spec?.tools || [];
  return tools.some((tool) => (tool as { name?: string }).name === toolName || (tool as { metadata?: { name?: string } }).metadata?.name === toolName);
}

async function proposeToolPatch(ctx: Record<string, unknown>, toolName: string, reason: string): Promise<void> {
  const liveConfig = ctx.liveConfig as { proposePatch?: (proposal: Record<string, unknown>) => Promise<unknown> } | undefined;
  if (!liveConfig?.proposePatch) return;
  await liveConfig.proposePatch({
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
