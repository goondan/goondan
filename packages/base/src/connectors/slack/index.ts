import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface SlackConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      agentName?: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
      metadata?: JsonObject;
    }) => Promise<void>;
    oauth?: { withContext?: (context: { auth?: JsonObject }) => { getAccessToken: (request: { oauthAppRef: ObjectRefLike; scopes?: string[] }) => Promise<JsonObject> } };
  };
  connectorConfig: JsonObject;
  logger?: Console;
}

export function createSlackConnector(options: SlackConnectorOptions) {
  const logger = options.logger || console;
  const config = options.connectorConfig as {
    metadata?: { name?: string };
    spec?: {
      ingress?: Array<JsonObject>;
      auth?: { staticToken?: { value?: string; valueFrom?: { env?: string } } };
    };
  };

  async function handleEvent(payload: JsonObject): Promise<void> {
    const ingressRules = config.spec?.ingress || [];
    const text = String(readPath(payload, '$.event.text') || payload.text || '');

    for (const rule of ingressRules) {
      const match = rule.match as { command?: string } | undefined;
      if (match?.command && !text.startsWith(match.command)) {
        continue;
      }

      const route = rule.route as {
        swarmRef?: ObjectRefLike;
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

  async function postMessage(input: { channel: string; text: string; threadTs?: string; auth?: JsonObject }): Promise<JsonObject> {
    let token = resolveStaticToken(config);
    if (!token) {
      const oauthAppRef = (config.spec?.auth as { oauthAppRef?: ObjectRefLike } | undefined)?.oauthAppRef;
      if (oauthAppRef && options.runtime.oauth?.withContext) {
        const result = await options.runtime.oauth.withContext({ auth: input.auth }).getAccessToken({ oauthAppRef });
        if (result.status !== 'ready') return result as JsonObject;
        const accessToken = (result as { accessToken?: string }).accessToken;
        if (!accessToken) return result as JsonObject;
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

    return (await response.json()) as JsonObject;
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

function buildOrigin(connectorName: string, payload: JsonObject): JsonObject {
  const channel = readPath(payload, '$.event.channel') || readPath(payload, '$.channel');
  const threadTs = readPath(payload, '$.event.thread_ts') || readPath(payload, '$.thread_ts');
  return {
    connector: connectorName,
    channel: typeof channel === 'string' ? channel : undefined,
    threadTs: typeof threadTs === 'string' ? threadTs : undefined,
  };
}

function buildAuth(payload: JsonObject): JsonObject {
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

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr) return undefined;
  if (!expr.startsWith('$.')) return undefined;
  const path = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}
