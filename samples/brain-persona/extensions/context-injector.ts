function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readRuntimeCatalog(metadata) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const raw = metadata.runtimeCatalog;
  if (!isRecord(raw)) {
    return undefined;
  }

  const swarmName = typeof raw.swarmName === 'string' ? raw.swarmName : undefined;
  const entryAgent = typeof raw.entryAgent === 'string' ? raw.entryAgent : undefined;
  const selfAgent = typeof raw.selfAgent === 'string' ? raw.selfAgent : undefined;
  const availableAgents = Array.isArray(raw.availableAgents)
    ? raw.availableAgents.filter((item) => typeof item === 'string')
    : [];
  const callableAgents = Array.isArray(raw.callableAgents)
    ? raw.callableAgents.filter((item) => typeof item === 'string')
    : [];

  if (!swarmName || !entryAgent || !selfAgent) {
    return undefined;
  }

  return {
    swarmName,
    entryAgent,
    selfAgent,
    availableAgents,
    callableAgents,
  };
}

function buildCatalogHint(catalog) {
  const lines = [
    '[runtime_catalog]',
    `swarm=${catalog.swarmName}`,
    `entryAgent=${catalog.entryAgent}`,
    `selfAgent=${catalog.selfAgent}`,
    `availableAgents=${catalog.availableAgents.join(', ')}`,
    `callableAgents=${catalog.callableAgents.join(', ')}`,
    '[/runtime_catalog]',
    '위 callableAgents를 참고해 위임 대상이 모호하면 agents__catalog로 최신 목록을 다시 확인한다.',
  ];
  return lines.join('\n');
}

export function register(api) {
  api.pipeline.register('turn', async (ctx) => {
    const catalog = readRuntimeCatalog(ctx.metadata);
    if (catalog) {
      ctx.emitMessageEvent({
        type: 'append',
        message: {
          id: createId('msg'),
          data: {
            role: 'system',
            content: buildCatalogHint(catalog),
          },
          metadata: {
            'context-injector.runtimeCatalog': true,
          },
          createdAt: new Date(),
          source: {
            type: 'extension',
            extensionName: 'context-injector',
          },
        },
      });
    }

    return ctx.next();
  });
}
