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

function createProperty(type: string | string[], description: string, extra: JsonObject = {}): JsonObject {
  return {
    type: Array.isArray(type) ? [...type] : type,
    description,
    ...extra,
  };
}

function stringProperty(description: string, extra: JsonObject = {}): JsonObject {
  return createProperty('string', description, extra);
}

function numberProperty(description: string, extra: JsonObject = {}): JsonObject {
  return createProperty('number', description, extra);
}

function booleanProperty(description: string, extra: JsonObject = {}): JsonObject {
  return createProperty('boolean', description, extra);
}

function objectProperty(description: string, extra: JsonObject = {}): JsonObject {
  return createProperty('object', description, extra);
}

function arrayProperty(description: string, items?: JsonObject, extra: JsonObject = {}): JsonObject {
  const payload: JsonObject = { ...extra };
  if (items) {
    payload.items = items;
  }
  return createProperty('array', description, payload);
}

function createParameters(properties: Record<string, JsonObject>, required: string[] = []): JsonObject {
  const parameters: JsonObject = {
    type: 'object',
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    parameters.required = [...required];
  }

  return parameters;
}

export function createBaseToolManifests(): BaseToolManifest[] {
  return [
    createToolManifest('bash', {
      entry: './src/tools/bash.ts',
      errorMessageLimit: 1200,
      exports: [
        {
          name: 'exec',
          description:
            'Execute one shell command using /bin/sh -lc in the current instance workspace.',
          parameters: createParameters(
            {
              command: stringProperty('Shell command string to execute.'),
              cwd: stringProperty('Optional working directory path relative to the instance workdir.'),
              timeoutMs: numberProperty('Maximum execution time in milliseconds (default: 30000).'),
              env: objectProperty(
                'Optional environment variable overrides merged with process.env before execution.'
              ),
            },
            ['command']
          ),
        },
        {
          name: 'script',
          description: 'Run a script file from workdir with optional arguments and custom shell.',
          parameters: createParameters(
            {
              path: stringProperty('Script file path relative to the instance workdir.'),
              args: arrayProperty(
                'Optional command-line arguments passed to the script in order.',
                stringProperty('Single script argument value.')
              ),
              shell: stringProperty('Shell binary path used to execute the script (default: /bin/bash).'),
              timeoutMs: numberProperty('Maximum execution time in milliseconds (default: 30000).'),
              env: objectProperty(
                'Optional environment variable overrides merged with process.env before execution.'
              ),
            },
            ['path']
          ),
        },
      ],
    }),
    createToolManifest('wait', {
      entry: './src/tools/wait.ts',
      errorMessageLimit: 600,
      exports: [
        {
          name: 'seconds',
          description: 'Pause execution for the specified number of seconds',
          parameters: createParameters(
            {
              seconds: numberProperty('Seconds to wait (range: 0 to 300).'),
            },
            ['seconds']
          ),
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
          parameters: createParameters(
            {
              path: stringProperty('File path relative to workdir to read.'),
              maxBytes: numberProperty('Maximum bytes to return from file content (default: 100000).'),
            },
            ['path']
          ),
        },
        {
          name: 'write',
          description: 'Write file content in workdir',
          parameters: createParameters(
            {
              path: stringProperty('File path relative to workdir to write. Parent directories are created automatically.'),
              content: stringProperty('UTF-8 text content to write.'),
              append: booleanProperty('When true, append content instead of overwriting the file (default: false).'),
            },
            ['path', 'content']
          ),
        },
        {
          name: 'list',
          description: 'List directory entries',
          parameters: createParameters({
            path: stringProperty('Directory path relative to workdir (default: ".").'),
            recursive: booleanProperty('When true, traverse subdirectories recursively (default: false).'),
            includeDirs: booleanProperty('Include directory entries in result (default: true).'),
            includeFiles: booleanProperty('Include file entries in result (default: true).'),
          }),
        },
        {
          name: 'mkdir',
          description: 'Create directory in workdir',
          parameters: createParameters(
            {
              path: stringProperty('Directory path relative to workdir to create.'),
              recursive: booleanProperty('Create parent directories when missing (default: true).'),
            },
            ['path']
          ),
        },
      ],
    }),
    createToolManifest('agents', {
      entry: './src/tools/agents.ts',
      errorMessageLimit: 1500,
      exports: [
        {
          name: 'request',
          description: 'Send request event to another agent (blocking or async queued response)',
          parameters: createParameters(
            {
              target: stringProperty('Target agent resource name to request.'),
              input: stringProperty('Text payload sent to the target agent.'),
              instanceKey: stringProperty('Optional target instance key. Defaults to current instanceKey.'),
              eventType: stringProperty('Custom event type string (default: "agent.request").'),
              timeoutMs: numberProperty('Response timeout in milliseconds (default: 60000).'),
              async: booleanProperty(
                'When true, return immediately and queue response into message inbox for the next step (default: false).'
              ),
              metadata: objectProperty('Optional metadata object attached to the request event.'),
            },
            ['target', 'input']
          ),
        },
        {
          name: 'send',
          description: 'Send fire-and-forget event to another agent',
          parameters: createParameters(
            {
              target: stringProperty('Target agent resource name to send event.'),
              input: stringProperty('Text payload sent to the target agent.'),
              instanceKey: stringProperty('Optional target instance key. Defaults to current instanceKey.'),
              eventType: stringProperty('Custom event type string (default: "agent.send").'),
              metadata: objectProperty('Optional metadata object attached to the event.'),
            },
            ['target', 'input']
          ),
        },
        {
          name: 'spawn',
          description:
            'Spawn or prepare an instance of an already-defined agent resource in the current swarm',
          parameters: createParameters(
            {
              target: stringProperty('Target agent resource name to spawn.'),
              instanceKey: stringProperty('Optional instance key for the spawned agent.'),
              cwd: stringProperty('Optional working directory for the spawned agent instance.'),
            },
            ['target']
          ),
        },
        {
          name: 'list',
          description: 'List spawned agent instances in this runtime',
          parameters: createParameters({
            includeAll: booleanProperty(
              'When true, include all known spawned agents beyond current ownership scope (default: false).'
            ),
          }),
        },
        {
          name: 'catalog',
          description: 'Describe available and callable agents in the selected swarm',
          parameters: createParameters({}),
        },
      ],
    }),
    createToolManifest('self-restart', {
      entry: './src/tools/self-restart.ts',
      exports: [
        {
          name: 'request',
          description: 'Request orchestrator self restart via runtime restart signal',
          parameters: createParameters({
            reason: stringProperty(
              'Optional restart reason for logs/observability. Defaults to "tool:self-restart".'
            ),
          }),
        },
      ],
    }),
    createToolManifest('telegram', {
      entry: './src/tools/telegram.ts',
      exports: [
        {
          name: 'send',
          description: 'Send a Telegram text message to a chat.',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              chatId: createProperty(
                ['string', 'number'],
                'Target chat id. Accepts Telegram chat id as string or integer.'
              ),
              text: stringProperty('Message text content to send.'),
              parseMode: stringProperty(
                'Optional parse mode alias.',
                {
                  enum: ['Markdown', 'MarkdownV2', 'HTML', 'markdown', 'markdownv2', 'markdown-v2', 'html'],
                }
              ),
              disableNotification: booleanProperty('Disable Telegram push notification for this message.'),
              disableWebPagePreview: booleanProperty('Disable link preview generation for message links.'),
              replyToMessageId: createProperty(
                ['number', 'string'],
                'Reply to an existing message id in the same chat.'
              ),
              allowSendingWithoutReply: booleanProperty('Send even when reply target message no longer exists.'),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['chatId', 'text']
          ),
        },
        {
          name: 'edit',
          description: 'Edit text of an existing Telegram message.',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              chatId: createProperty(
                ['string', 'number'],
                'Target chat id. Accepts Telegram chat id as string or integer.'
              ),
              messageId: createProperty(['number', 'string'], 'Message id to edit (positive integer).'),
              text: stringProperty('New message text content.'),
              parseMode: stringProperty(
                'Optional parse mode alias.',
                {
                  enum: ['Markdown', 'MarkdownV2', 'HTML', 'markdown', 'markdownv2', 'markdown-v2', 'html'],
                }
              ),
              disableWebPagePreview: booleanProperty('Disable link preview generation for message links.'),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['chatId', 'messageId', 'text']
          ),
        },
        {
          name: 'delete',
          description: 'Delete Telegram message from a chat',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              chatId: createProperty(
                ['string', 'number'],
                'Target chat id. Accepts Telegram chat id as string or integer.'
              ),
              messageId: createProperty(['number', 'string'], 'Message id to delete (positive integer).'),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['chatId', 'messageId']
          ),
        },
        {
          name: 'react',
          description: 'Add, replace, or clear Telegram message reactions.',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              chatId: createProperty(
                ['string', 'number'],
                'Target chat id. Accepts Telegram chat id as string or integer.'
              ),
              messageId: createProperty(['number', 'string'], 'Message id to react to (positive integer).'),
              emoji: stringProperty('Single emoji reaction to set (ignored when clear=true).'),
              emojis: arrayProperty(
                'Multiple emoji reactions to set (ignored when clear=true).',
                stringProperty('Single emoji reaction value.')
              ),
              clear: booleanProperty('When true, clear reactions instead of setting them.'),
              isBig: booleanProperty('Use big reaction animation if supported by Telegram clients.'),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['chatId', 'messageId']
          ),
        },
        {
          name: 'setChatAction',
          description: 'Set Telegram bot chat action (typing/upload...)',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              chatId: createProperty(
                ['string', 'number'],
                'Target chat id. Accepts Telegram chat id as string or integer.'
              ),
              action: stringProperty(
                'Chat action to set.',
                {
                  enum: [
                    'typing',
                    'upload-photo',
                    'record-video',
                    'upload-video',
                    'record-voice',
                    'upload-voice',
                    'upload-document',
                    'choose-sticker',
                    'find-location',
                    'record-video-note',
                    'upload-video-note',
                  ],
                }
              ),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['chatId']
          ),
        },
        {
          name: 'downloadFile',
          description: 'Resolve and download a Telegram file by file id.',
          parameters: createParameters(
            {
              token: stringProperty(
                'Bot token. Optional when TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN is set.'
              ),
              fileId: stringProperty('Telegram file id to download (preferred field).'),
              maxBytes: numberProperty('Maximum downloaded bytes allowed (default: 3000000).'),
              includeBase64: booleanProperty('Include base64-encoded content in the result (default: true).'),
              includeDataUrl: booleanProperty('Include data URL when base64 is included (default: true).'),
              savePath: stringProperty('Optional path relative to workdir to save the downloaded file.'),
              timeoutMs: numberProperty('Telegram API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Telegram API base URL override.'),
            },
            ['fileId']
          ),
        },
      ],
    }),
    createToolManifest('slack', {
      entry: './src/tools/slack.ts',
      exports: [
        {
          name: 'send',
          description: 'Send Slack message to a channel',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              channelId: stringProperty('Target channel id to post message.'),
              text: stringProperty('Message text content to post.'),
              threadTs: stringProperty('Optional parent thread timestamp for thread replies.'),
              mrkdwn: booleanProperty('Enable Slack mrkdwn parsing for message text.'),
              unfurlLinks: booleanProperty('Enable automatic link unfurling.'),
              unfurlMedia: booleanProperty('Enable automatic media unfurling.'),
              replyBroadcast: booleanProperty('Broadcast thread reply to channel timeline.'),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['channelId', 'text']
          ),
        },
        {
          name: 'read',
          description: 'Read Slack channel or thread messages',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              channelId: stringProperty('Target channel id to read from.'),
              messageTs: stringProperty('Specific message timestamp to find in history.'),
              threadTs: stringProperty('Thread root timestamp. When set, reads thread replies.'),
              latest: stringProperty('Upper time boundary (inclusive/exclusive depends on inclusive flag).'),
              oldest: stringProperty('Lower time boundary (inclusive/exclusive depends on inclusive flag).'),
              inclusive: booleanProperty('Include boundary messages when latest/oldest are set.'),
              limit: numberProperty('Maximum messages to return (1 to 1000).'),
              cursor: stringProperty('Pagination cursor for next page.'),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['channelId']
          ),
        },
        {
          name: 'edit',
          description: 'Edit Slack message text',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              channelId: stringProperty('Target channel id containing the message.'),
              messageTs: stringProperty('Timestamp of the message to edit.'),
              text: stringProperty('New message text content.'),
              mrkdwn: booleanProperty('Enable Slack mrkdwn parsing for updated text.'),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['channelId', 'messageTs', 'text']
          ),
        },
        {
          name: 'delete',
          description: 'Delete Slack message from a channel',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              channelId: stringProperty('Target channel id containing the message.'),
              messageTs: stringProperty('Timestamp of the message to delete.'),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['channelId', 'messageTs']
          ),
        },
        {
          name: 'react',
          description: 'Add one or more Slack reactions to a message',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              channelId: stringProperty('Target channel id containing the message.'),
              messageTs: stringProperty('Timestamp of the message to react to.'),
              emoji: stringProperty('Single emoji name to add, with or without surrounding colons.'),
              emojis: arrayProperty(
                'Multiple emoji names to add, each with or without surrounding colons.',
                stringProperty('Single emoji name value.')
              ),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['channelId', 'messageTs']
          ),
        },
        {
          name: 'downloadFile',
          description: 'Download Slack file/image with bot token auth',
          parameters: createParameters(
            {
              token: stringProperty('Slack bot token. Optional when SLACK_BOT_TOKEN/SLACK_TOKEN is set.'),
              url: stringProperty('Download URL to fetch (preferred field).'),
              maxBytes: numberProperty('Maximum downloaded bytes allowed (default: 3000000).'),
              includeBase64: booleanProperty('Include base64-encoded content in the result (default: true).'),
              includeDataUrl: booleanProperty('Include data URL when base64 is included (default: true).'),
              savePath: stringProperty('Optional path relative to workdir to save the downloaded file.'),
              timeoutMs: numberProperty('Slack API timeout in milliseconds (default: 15000).'),
              apiBaseUrl: stringProperty('Optional Slack API base URL override.'),
            },
            ['url']
          ),
        },
      ],
    }),
    createToolManifest('http-fetch', {
      entry: './src/tools/http-fetch.ts',
      exports: [
        {
          name: 'get',
          description: 'Perform HTTP GET request',
          parameters: createParameters(
            {
              url: stringProperty('HTTP/HTTPS URL to request.'),
              headers: objectProperty('Optional request headers object. Primitive values are stringified.'),
              timeoutMs: numberProperty('Request timeout in milliseconds (default: 30000).'),
              maxBytes: numberProperty('Maximum response body bytes returned (default: 500000).'),
            },
            ['url']
          ),
        },
        {
          name: 'post',
          description: 'Perform HTTP POST request',
          parameters: createParameters(
            {
              url: stringProperty('HTTP/HTTPS URL to request.'),
              body: objectProperty(
                'JSON body object. When provided, it is stringified and content-type defaults to application/json.'
              ),
              bodyString: stringProperty('Raw string request body. Ignored when body is provided.'),
              headers: objectProperty('Optional request headers object. Primitive values are stringified.'),
              timeoutMs: numberProperty('Request timeout in milliseconds (default: 30000).'),
              maxBytes: numberProperty('Maximum response body bytes returned (default: 500000).'),
            },
            ['url']
          ),
        },
      ],
    }),
    createToolManifest('json-query', {
      entry: './src/tools/json-query.ts',
      exports: [
        {
          name: 'query',
          description: 'Query JSON data by dot-notation path',
          parameters: createParameters(
            {
              data: stringProperty('Input JSON string to parse and query.'),
              path: stringProperty('Dot/bracket path expression. Defaults to "." for root.'),
            },
            ['data']
          ),
        },
        {
          name: 'pick',
          description: 'Pick specific keys from JSON object',
          parameters: createParameters(
            {
              data: stringProperty('Input JSON string expected to be an object.'),
              keys: arrayProperty('Object keys to pick from parsed JSON object.', stringProperty('Key name to pick.')),
            },
            ['data', 'keys']
          ),
        },
        {
          name: 'count',
          description: 'Count elements at a JSON path',
          parameters: createParameters(
            {
              data: stringProperty('Input JSON string to parse.'),
              path: stringProperty('Dot/bracket path expression to count at. Defaults to "." for root.'),
            },
            ['data']
          ),
        },
        {
          name: 'flatten',
          description: 'Flatten nested JSON arrays',
          parameters: createParameters(
            {
              data: stringProperty('Input JSON string expected to be an array.'),
              depth: numberProperty('Flatten depth level (default: 1).'),
            },
            ['data']
          ),
        },
      ],
    }),
    createToolManifest('text-transform', {
      entry: './src/tools/text-transform.ts',
      exports: [
        {
          name: 'replace',
          description: 'Replace text occurrences',
          parameters: createParameters(
            {
              text: stringProperty('Source text to transform.'),
              search: stringProperty('Search string to find in text.'),
              replacement: stringProperty('Replacement string (default: empty string).'),
              all: booleanProperty('Replace all occurrences instead of first occurrence only.'),
            },
            ['text', 'search']
          ),
        },
        {
          name: 'slice',
          description: 'Extract substring by start/end positions',
          parameters: createParameters(
            {
              text: stringProperty('Source text to slice.'),
              start: numberProperty('Start index (default: 0).'),
              end: numberProperty('Optional end index (exclusive).'),
            },
            ['text']
          ),
        },
        {
          name: 'split',
          description: 'Split text by delimiter',
          parameters: createParameters(
            {
              text: stringProperty('Source text to split.'),
              delimiter: stringProperty('Delimiter string (default: newline).'),
              maxParts: numberProperty('Optional maximum number of split parts to return.'),
            },
            ['text']
          ),
        },
        {
          name: 'join',
          description: 'Join array of strings with delimiter',
          parameters: createParameters(
            {
              parts: arrayProperty(
                'List of values to join into a single string.',
                createProperty(
                  ['string', 'number', 'boolean'],
                  'Part value. Numbers/booleans are stringified before join.'
                )
              ),
              delimiter: stringProperty('Delimiter string inserted between parts (default: newline).'),
            },
            ['parts']
          ),
        },
        {
          name: 'trim',
          description: 'Trim whitespace from text',
          parameters: createParameters(
            {
              text: stringProperty('Source text to trim.'),
              mode: stringProperty('Trim mode (default: both).', {
                enum: ['start', 'end', 'both'],
              }),
            },
            ['text']
          ),
        },
        {
          name: 'case',
          description: 'Transform text case (upper/lower)',
          parameters: createParameters(
            {
              text: stringProperty('Source text to transform.'),
              to: stringProperty('Target case transform mode.', {
                enum: ['upper', 'lower'],
              }),
            },
            ['text', 'to']
          ),
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
    createExtensionManifest('required-tools-guard', './src/extensions/required-tools-guard.ts', {
      requiredTools: [],
      errorMessage: '',
    }),
    createExtensionManifest('inter-agent-response-format', './src/extensions/inter-agent-response-format.ts'),
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
