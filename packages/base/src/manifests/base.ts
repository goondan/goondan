import type {
  ConnectionManifestSpec,
  ConnectorManifestSpec,
  ExtensionManifestSpec,
  JsonObject,
  ResourceManifest,
  ToolManifestSpec,
} from '../types.js';

export type BaseToolManifest = ResourceManifest<'Tool', ToolManifestSpec>;
export type BaseExtensionManifest = ResourceManifest<'Extension', ExtensionManifestSpec>;
export type BaseConnectorManifest = ResourceManifest<'Connector', ConnectorManifestSpec>;
export type BaseConnectionManifest = ResourceManifest<'Connection', ConnectionManifestSpec>;

export type BaseManifest =
  | BaseToolManifest
  | BaseExtensionManifest
  | BaseConnectorManifest
  | BaseConnectionManifest;

function createToolManifest(name: string, spec: ToolManifestSpec): BaseToolManifest {
  return {
    apiVersion: 'goondan.ai/v1',
    kind: 'Tool',
    metadata: {
      name,
      labels: {
        tier: 'base',
      },
    },
    spec,
  };
}

function createExtensionManifest(
  name: string,
  entry: string,
  config?: JsonObject
): BaseExtensionManifest {
  const spec: ExtensionManifestSpec = {
    entry,
  };

  if (config) {
    spec.config = config;
  }

  return {
    apiVersion: 'goondan.ai/v1',
    kind: 'Extension',
    metadata: {
      name,
      labels: {
        tier: 'base',
      },
    },
    spec,
  };
}

function createConnectorManifest(
  name: string,
  spec: ConnectorManifestSpec
): BaseConnectorManifest {
  return {
    apiVersion: 'goondan.ai/v1',
    kind: 'Connector',
    metadata: {
      name,
      labels: {
        tier: 'base',
      },
    },
    spec,
  };
}

export function createBaseToolManifests(): BaseToolManifest[] {
  return [
    createToolManifest('bash', {
      entry: './src/tools/bash.ts',
      errorMessageLimit: 1200,
      exports: [
        {
          name: 'exec',
          description: 'Run shell command in instance workdir',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              cwd: { type: 'string' },
              timeoutMs: { type: 'number' },
              env: { type: 'object' },
            },
            required: ['command'],
          },
        },
        {
          name: 'script',
          description: 'Run script file path with optional args',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              args: { type: 'array' },
              shell: { type: 'string' },
              timeoutMs: { type: 'number' },
              env: { type: 'object' },
            },
            required: ['path'],
          },
        },
      ],
    }),
    createToolManifest('file-system', {
      entry: './src/tools/file-system.ts',
      errorMessageLimit: 2000,
      exports: [
        {
          name: 'read',
          description: 'Read file content from workdir',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              maxBytes: { type: 'number' },
            },
            required: ['path'],
          },
        },
        {
          name: 'write',
          description: 'Write file content in workdir',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              append: { type: 'boolean' },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'list',
          description: 'List directory entries',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              recursive: { type: 'boolean' },
              includeDirs: { type: 'boolean' },
              includeFiles: { type: 'boolean' },
            },
          },
        },
        {
          name: 'mkdir',
          description: 'Create directory in workdir',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              recursive: { type: 'boolean' },
            },
            required: ['path'],
          },
        },
      ],
    }),
    createToolManifest('agents', {
      entry: './src/tools/agents.ts',
      errorMessageLimit: 1500,
      exports: [
        {
          name: 'request',
          description: 'Send request event to another agent and wait for response',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              input: { type: 'string' },
              instanceKey: { type: 'string' },
              eventType: { type: 'string' },
              timeoutMs: { type: 'number' },
              metadata: { type: 'object' },
            },
            required: ['target'],
          },
        },
        {
          name: 'send',
          description: 'Send fire-and-forget event to another agent',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              input: { type: 'string' },
              instanceKey: { type: 'string' },
              eventType: { type: 'string' },
              metadata: { type: 'object' },
            },
            required: ['target'],
          },
        },
        {
          name: 'spawn',
          description:
            'Spawn or prepare an instance of an already-defined agent resource in the current swarm',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              instanceKey: { type: 'string' },
              cwd: { type: 'string' },
            },
            required: ['target'],
          },
        },
        {
          name: 'list',
          description: 'List spawned agent instances in this runtime',
          parameters: {
            type: 'object',
            properties: {
              includeAll: { type: 'boolean' },
            },
          },
        },
        {
          name: 'catalog',
          description: 'Describe available and callable agents in the selected swarm',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }),
    createToolManifest('http-fetch', {
      entry: './src/tools/http-fetch.ts',
      exports: [
        {
          name: 'get',
          description: 'Perform HTTP GET request',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              headers: { type: 'object' },
              timeoutMs: { type: 'number' },
              maxBytes: { type: 'number' },
            },
            required: ['url'],
          },
        },
        {
          name: 'post',
          description: 'Perform HTTP POST request',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              body: { type: 'object' },
              bodyString: { type: 'string' },
              headers: { type: 'object' },
              timeoutMs: { type: 'number' },
              maxBytes: { type: 'number' },
            },
            required: ['url'],
          },
        },
      ],
    }),
    createToolManifest('json-query', {
      entry: './src/tools/json-query.ts',
      exports: [
        {
          name: 'query',
          description: 'Query JSON data by dot-notation path',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['data'],
          },
        },
        {
          name: 'pick',
          description: 'Pick specific keys from JSON object',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'string' },
              keys: { type: 'array' },
            },
            required: ['data', 'keys'],
          },
        },
        {
          name: 'count',
          description: 'Count elements at a JSON path',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['data'],
          },
        },
        {
          name: 'flatten',
          description: 'Flatten nested JSON arrays',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'string' },
              depth: { type: 'number' },
            },
            required: ['data'],
          },
        },
      ],
    }),
    createToolManifest('text-transform', {
      entry: './src/tools/text-transform.ts',
      exports: [
        {
          name: 'replace',
          description: 'Replace text occurrences',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              search: { type: 'string' },
              replacement: { type: 'string' },
              all: { type: 'boolean' },
            },
            required: ['text', 'search'],
          },
        },
        {
          name: 'slice',
          description: 'Extract substring by start/end positions',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              start: { type: 'number' },
              end: { type: 'number' },
            },
            required: ['text'],
          },
        },
        {
          name: 'split',
          description: 'Split text by delimiter',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              delimiter: { type: 'string' },
              maxParts: { type: 'number' },
            },
            required: ['text'],
          },
        },
        {
          name: 'join',
          description: 'Join array of strings with delimiter',
          parameters: {
            type: 'object',
            properties: {
              parts: { type: 'array' },
              delimiter: { type: 'string' },
            },
            required: ['parts'],
          },
        },
        {
          name: 'trim',
          description: 'Trim whitespace from text',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              mode: { type: 'string' },
            },
            required: ['text'],
          },
        },
        {
          name: 'case',
          description: 'Transform text case (upper/lower)',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              to: { type: 'string' },
            },
            required: ['text', 'to'],
          },
        },
      ],
    }),
  ];
}

export function createBaseExtensionManifests(): BaseExtensionManifest[] {
  return [
    createExtensionManifest('logging', './src/extensions/logging.ts', {
      level: 'info',
      includeToolArgs: false,
    }),
    createExtensionManifest('message-compaction', './src/extensions/compaction.ts', {
      maxMessages: 40,
      maxCharacters: 12000,
      retainLastMessages: 8,
      mode: 'remove',
      appendSummary: true,
    }),
    createExtensionManifest('message-window', './src/extensions/message-window.ts', {
      maxMessages: 80,
    }),
    createExtensionManifest('tool-search', './src/extensions/tool-search.ts', {
      toolName: 'tool-search__search',
      maxResults: 10,
      minQueryLength: 1,
      persistSelection: true,
    }),
  ];
}

export function createBaseConnectorManifests(): BaseConnectorManifest[] {
  return [
    createConnectorManifest('cli', {
      entry: './src/connectors/cli.ts',
      events: [
        {
          name: 'stdin_message',
          properties: {
            source: { type: 'string', optional: true },
          },
        },
      ],
    }),
    createConnectorManifest('webhook', {
      entry: './src/connectors/webhook.ts',
      events: [
        {
          name: 'webhook_message',
          properties: {
            route: { type: 'string', optional: true },
          },
        },
      ],
    }),
    createConnectorManifest('telegram-polling', {
      entry: './src/connectors/telegram-polling.ts',
      events: [
        {
          name: 'telegram_message',
          properties: {
            update_id: { type: 'number', optional: true },
            chat_id: { type: 'string', optional: true },
            chat_type: { type: 'string', optional: true },
            chat_title: { type: 'string', optional: true },
            chat_username: { type: 'string', optional: true },
            message_id: { type: 'number', optional: true },
            date: { type: 'number', optional: true },
            from_id: { type: 'string', optional: true },
            from_username: { type: 'string', optional: true },
            from_first_name: { type: 'string', optional: true },
            from_last_name: { type: 'string', optional: true },
          },
        },
      ],
    }),
    createConnectorManifest('slack', {
      entry: './src/connectors/slack.ts',
      events: [
        {
          name: 'app_mention',
          properties: {
            channel_id: { type: 'string' },
            ts: { type: 'string' },
            thread_ts: { type: 'string', optional: true },
            user_id: { type: 'string', optional: true },
          },
        },
        {
          name: 'message_im',
          properties: {
            channel_id: { type: 'string' },
            ts: { type: 'string' },
            user_id: { type: 'string', optional: true },
          },
        },
      ],
    }),
    createConnectorManifest('discord', {
      entry: './src/connectors/discord.ts',
      events: [
        {
          name: 'slash_command',
          properties: {
            interaction_id: { type: 'string', optional: true },
            channel_id: { type: 'string', optional: true },
            guild_id: { type: 'string', optional: true },
            command_name: { type: 'string', optional: true },
            user_id: { type: 'string', optional: true },
          },
        },
        {
          name: 'component_interaction',
          properties: {
            interaction_id: { type: 'string', optional: true },
            channel_id: { type: 'string', optional: true },
            custom_id: { type: 'string', optional: true },
          },
        },
      ],
    }),
    createConnectorManifest('github', {
      entry: './src/connectors/github.ts',
      events: [
        {
          name: 'github_push',
          properties: {
            repo: { type: 'string', optional: true },
            ref: { type: 'string', optional: true },
            sender: { type: 'string', optional: true },
          },
        },
        {
          name: 'github_pull_request',
          properties: {
            repo: { type: 'string', optional: true },
            action: { type: 'string', optional: true },
            number: { type: 'string', optional: true },
            sender: { type: 'string', optional: true },
          },
        },
        {
          name: 'github_issue',
          properties: {
            repo: { type: 'string', optional: true },
            action: { type: 'string', optional: true },
            number: { type: 'string', optional: true },
            sender: { type: 'string', optional: true },
          },
        },
        {
          name: 'github_issue_comment',
          properties: {
            repo: { type: 'string', optional: true },
            action: { type: 'string', optional: true },
            number: { type: 'string', optional: true },
            sender: { type: 'string', optional: true },
          },
        },
      ],
    }),
  ];
}

export interface BaseConnectionOptions {
  name?: string;
  connectorName?: string;
  swarmName?: string;
  eventName?: string;
  agentName?: string;
}

export function createBaseConnectionManifest(
  options: BaseConnectionOptions = {}
): BaseConnectionManifest {
  const connectorName = options.connectorName ?? 'cli';
  const swarmName = options.swarmName ?? 'default';
  const eventName = options.eventName ?? 'stdin_message';

  const spec: ConnectionManifestSpec = {
    connectorRef: `Connector/${connectorName}`,
    swarmRef: `Swarm/${swarmName}`,
    config: {
      PORT: {
        valueFrom: {
          env: 'GOONDAN_CONNECTOR_PORT',
        },
      },
    },
    verify: {
      webhook: {
        signingSecret: {
          valueFrom: {
            env: 'GOONDAN_WEBHOOK_SIGNING_SECRET',
          },
        },
      },
    },
    ingress: {
      rules: [
        {
          match: {
            event: eventName,
          },
          route: options.agentName
            ? {
                agentRef: `Agent/${options.agentName}`,
              }
            : {},
        },
      ],
    },
  };

  return {
    apiVersion: 'goondan.ai/v1',
    kind: 'Connection',
    metadata: {
      name: options.name ?? `${connectorName}-to-${swarmName}`,
      labels: {
        tier: 'base',
      },
    },
    spec,
  };
}

export function createBaseManifestSet(): BaseManifest[] {
  return [
    ...createBaseToolManifests(),
    ...createBaseExtensionManifests(),
    ...createBaseConnectorManifests(),
    createBaseConnectionManifest(),
  ];
}
