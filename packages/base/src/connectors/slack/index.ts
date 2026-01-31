interface SlackConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: Record<string, unknown>;
      instanceKey: string;
      agentName?: string;
      input: string;
      origin?: Record<string, unknown>;
      auth?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
    oauth?: { withContext?: (context: { auth?: Record<string, unknown> }) => { getAccessToken: (request: { oauthAppRef: { kind: string; name: string }; scopes?: string[] }) => Promise<Record<string, unknown>> } };
  };
  connectorConfig: Record<string, unknown>;
  logger?: Console;
}

export function createSlackConnector(options: SlackConnectorOptions) {
  const logger = options.logger || console;
  const config = options.connectorConfig as {
    metadata?: { name?: string };
    spec?: {
      ingress?: Array<Record<string, unknown>>;
      auth?: { staticToken?: { value?: string; valueFrom?: { env?: string } } };
    };
  };

  async function handleEvent(payload: Record<string, unknown>): Promise<void> {
    const ingressRules = config.spec?.ingress || [];
    const text = String(readPath(payload, '$.event.text') || payload.text || '');

    for (const rule of ingressRules) {
      const match = rule.match as { command?: string } | undefined;
      if (match?.command && !text.startsWith(match.command)) {
        continue;
      }

      const route = rule.route as {
        swarmRef?: Record<string, unknown>;
        instanceKeyFrom?: string;
        inputFrom?: string;
        agentName?: string;
      };

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

  async function postMessage(input: { channel: string; text: string; threadTs?: string; auth?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    let token = resolveStaticToken(config);
    if (!token) {
      const oauthAppRef = (config.spec?.auth as { oauthAppRef?: { kind: string; name: string } } | undefined)?.oauthAppRef;
      if (oauthAppRef && options.runtime.oauth?.withContext) {
        const result = await options.runtime.oauth.withContext({ auth: input.auth as { subjects?: { global?: string; user?: string } } }).getAccessToken({ oauthAppRef });
        if (result.status !== 'ready') return result as Record<string, unknown>;
        const accessToken = (result as { accessToken?: string }).accessToken;
        if (!accessToken) return result as Record<string, unknown>;
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
        channel: input.channel,
        text: input.text,
        thread_ts: input.threadTs,
      }),
    });

    return response.json();
  }

  return { handleEvent, postMessage };
}

function resolveStaticToken(config: { spec?: { auth?: { staticToken?: { value?: string; valueFrom?: { env?: string } } } } }) {
  const tokenConfig = config.spec?.auth?.staticToken;
  if (!tokenConfig) return undefined;
  if (tokenConfig.value) return tokenConfig.value;
  if (tokenConfig.valueFrom?.env) return process.env[tokenConfig.valueFrom.env];
  return undefined;
}

function buildOrigin(connectorName: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    connector: connectorName,
    channel: readPath(payload, '$.event.channel') || readPath(payload, '$.channel') || undefined,
    threadTs: readPath(payload, '$.event.thread_ts') || readPath(payload, '$.thread_ts') || undefined,
  };
}

function buildAuth(payload: Record<string, unknown>): Record<string, unknown> {
  const teamId = readPath(payload, '$.team_id') || readPath(payload, '$.event.team') || readPath(payload, '$.team') || undefined;
  const userId = readPath(payload, '$.event.user') || readPath(payload, '$.user') || undefined;

  return {
    actor: userId ? { type: 'user', id: `slack:${userId}` } : undefined,
    subjects: {
      global: teamId ? `slack:team:${teamId}` : undefined,
      user: teamId && userId ? `slack:user:${teamId}:${userId}` : undefined,
    },
  };
}

function readPath(payload: Record<string, unknown>, expr?: string): unknown {
  if (!expr) return undefined;
  if (!expr.startsWith('$.')) return undefined;
  const path = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
