export function createSlackConnector(options) {
    const logger = options.logger || console;
    const config = options.connectorConfig;
    async function handleEvent(payload) {
        const ingressRules = config.spec?.ingress || [];
        const text = String(readPath(payload, '$.event.text') || payload.text || '');
        for (const rule of ingressRules) {
            const match = rule.match;
            if (match?.command && !text.startsWith(match.command)) {
                continue;
            }
            const route = rule.route;
            if (!route?.swarmRef) {
                logger.warn('swarmRef가 없는 ingress rule입니다.');
                continue;
            }
            const instanceKey = String(readPath(payload, route.instanceKeyFrom || '$.event.thread_ts') || 'default');
            const input = String(readPath(payload, route.inputFrom || '$.event.text') || text);
            await options.runtime.handleEvent({
                swarmRef: route.swarmRef,
                instanceKey,
                agentName: route.agentName,
                input,
                origin: buildOrigin(config.metadata?.name || 'slack', payload),
                auth: buildAuth(payload),
                metadata: { connector: config.metadata?.name || 'slack' },
            });
            return;
        }
    }
    async function send(input) {
        const channel = input.origin?.channel;
        const threadTs = input.origin?.threadTs;
        if (!channel) {
            throw new Error('Slack connector: origin.channel이 필요합니다.');
        }
        let token = resolveStaticToken(config);
        if (!token) {
            const oauthAppRef = config.spec?.auth?.oauthAppRef;
            if (oauthAppRef && options.runtime.oauth?.withContext) {
                const result = await options.runtime.oauth.withContext({ auth: input.auth }).getAccessToken({ oauthAppRef });
                if (result.status !== 'ready')
                    return result;
                const accessToken = result.accessToken;
                if (!accessToken)
                    return result;
                token = accessToken;
            }
        }
        if (!token) {
            throw new Error('Slack staticToken이 필요합니다.');
        }
        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                channel,
                text: input.text,
                thread_ts: threadTs,
            }),
        });
        return (await response.json());
    }
    return { handleEvent, send };
}
function resolveStaticToken(config) {
    const tokenConfig = config.spec?.auth?.staticToken;
    if (!tokenConfig)
        return undefined;
    if (tokenConfig.value)
        return tokenConfig.value;
    if (tokenConfig.valueFrom?.env)
        return process.env[tokenConfig.valueFrom.env];
    return undefined;
}
function buildOrigin(connectorName, payload) {
    const channel = readPath(payload, '$.event.channel') || readPath(payload, '$.channel');
    const threadTs = readPath(payload, '$.event.thread_ts') || readPath(payload, '$.thread_ts');
    return {
        connector: connectorName,
        channel: typeof channel === 'string' ? channel : undefined,
        threadTs: typeof threadTs === 'string' ? threadTs : undefined,
    };
}
function buildAuth(payload) {
    const teamId = readPath(payload, '$.team_id') || readPath(payload, '$.event.team') || readPath(payload, '$.team');
    const userId = readPath(payload, '$.event.user') || readPath(payload, '$.user');
    const team = typeof teamId === 'string' ? teamId : undefined;
    const user = typeof userId === 'string' ? userId : undefined;
    return {
        actor: user ? { type: 'user', id: `slack:${user}` } : undefined,
        subjects: {
            global: team ? `slack:team:${team}` : undefined,
            user: team && user ? `slack:user:${team}:${user}` : undefined,
        },
    };
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