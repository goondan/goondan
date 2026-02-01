export function createCliConnector(options) {
    const logger = options.logger || console;
    const config = options.connectorConfig;
    async function handleEvent(payload) {
        const ingressRules = config.spec?.ingress || [];
        const text = String(payload.text || '');
        for (const rule of ingressRules) {
            const match = rule.match;
            if (match?.command && !text.startsWith(match.command)) {
                continue;
            }
            const route = rule.route;
            if (!route?.swarmRef) {
                logger.warn('cli ingress rule에 swarmRef가 없습니다.');
                continue;
            }
            const instanceKey = String(readPath(payload, route.instanceKeyFrom || '$.instanceKey') || 'cli');
            const input = String(readPath(payload, route.inputFrom || '$.text') || text);
            await options.runtime.handleEvent({
                swarmRef: route.swarmRef,
                instanceKey,
                agentName: route.agentName,
                input,
                origin: { connector: config.metadata?.name || 'cli' },
                auth: {},
                metadata: { connector: config.metadata?.name || 'cli' },
            });
            return;
        }
        if (ingressRules.length === 0 && payload.swarmRef) {
            await options.runtime.handleEvent({
                swarmRef: payload.swarmRef,
                instanceKey: String(payload.instanceKey || 'cli'),
                agentName: payload.agentName,
                input: text,
                origin: { connector: config.metadata?.name || 'cli' },
                auth: {},
                metadata: { connector: config.metadata?.name || 'cli' },
            });
        }
    }
    async function postMessage(input) {
        if (input?.text) {
            console.log(input.text);
        }
        return { ok: true };
    }
    return { handleEvent, postMessage };
}
function readPath(payload, expr) {
    if (!expr)
        return undefined;
    if (!expr.startsWith('$.'))
        return undefined;
    const path = expr.slice(2).split('.');
    let current = payload;
    for (const key of path) {
        if (current == null)
            return undefined;
        current = current[key];
    }
    return current;
}
//# sourceMappingURL=index.js.map