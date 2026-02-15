import { Console } from 'node:console';
import { pathToFileURL } from 'node:url';
import { isJsonObject, type ConnectorContext } from '@goondan/runtime';

interface ConnectorChildStartMessage {
  type: 'connector_start';
  connectorEntryPath: string;
  connectionName: string;
  connectorName: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

interface ConnectorChildShutdownMessage {
  type: 'connector_shutdown';
}

interface ConnectorChildStartedMessage {
  type: 'connector_started';
}

interface ConnectorChildStartErrorMessage {
  type: 'connector_start_error';
  message: string;
}

interface ConnectorChildEventMessage {
  type: 'connector_event';
  event: unknown;
}

type ConnectorChildMessage =
  | ConnectorChildStartedMessage
  | ConnectorChildStartErrorMessage
  | ConnectorChildEventMessage;

type ConnectorRunner = (ctx: ConnectorContext) => Promise<void>;
type StartupProbe = { state: 'pending' } | { state: 'resolved' } | { state: 'rejected'; error: unknown };

interface RunningConnectorState {
  connectionName: string;
  connectorName: string;
  execution: Promise<void>;
}

let runningConnector: RunningConnectorState | undefined;
let shutdownRequested = false;

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isJsonObject(value)) {
    return false;
  }

  for (const item of Object.values(value)) {
    if (typeof item !== 'string') {
      return false;
    }
  }

  return true;
}

function isConnectorChildStartMessage(message: unknown): message is ConnectorChildStartMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return (
    message.type === 'connector_start' &&
    typeof message.connectorEntryPath === 'string' &&
    typeof message.connectionName === 'string' &&
    typeof message.connectorName === 'string' &&
    isStringRecord(message.config) &&
    isStringRecord(message.secrets)
  );
}

function isConnectorChildShutdownMessage(message: unknown): message is ConnectorChildShutdownMessage {
  if (!isJsonObject(message)) {
    return false;
  }

  return message.type === 'connector_shutdown';
}

function isConnectorRunner(value: unknown): value is ConnectorRunner {
  return typeof value === 'function';
}

function pendingProbe(): StartupProbe {
  return { state: 'pending' };
}

function resolvedProbe(): StartupProbe {
  return { state: 'resolved' };
}

function rejectedProbe(error: unknown): StartupProbe {
  return { state: 'rejected', error };
}

function sendMessage(message: ConnectorChildMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function unknownToErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createConnectorLogger(connectionName: string, connectorName: string): Console {
  const prefix = `[goondan-runtime][${connectionName}/${connectorName}]`;
  const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
  logger.debug = (...args: unknown[]): void => {
    console.debug(prefix, ...args);
  };
  logger.info = (...args: unknown[]): void => {
    console.info(prefix, ...args);
  };
  logger.warn = (...args: unknown[]): void => {
    console.warn(prefix, ...args);
  };
  logger.error = (...args: unknown[]): void => {
    console.error(prefix, ...args);
  };
  return logger;
}

async function importConnectorRunner(entryPath: string): Promise<ConnectorRunner> {
  const loaded: unknown = await import(pathToFileURL(entryPath).href);
  if (!isJsonObject(loaded)) {
    throw new Error(`Connector 모듈 로드 결과가 객체가 아닙니다: ${entryPath}`);
  }

  const defaultExport = loaded.default;
  if (!isConnectorRunner(defaultExport)) {
    throw new Error(`Connector 모듈 default export가 함수가 아닙니다: ${entryPath}`);
  }

  return defaultExport;
}

async function probeConnectorStartup(
  connectionName: string,
  connectorName: string,
  execution: Promise<void>,
): Promise<void> {
  const outcome = await Promise.race([
    execution.then(() => resolvedProbe()).catch((error: unknown) => rejectedProbe(error)),
    new Promise<StartupProbe>((resolve) => {
      setTimeout(() => resolve(pendingProbe()), 0);
    }),
  ]);

  if (outcome.state === 'pending') {
    return;
  }

  if (outcome.state === 'resolved') {
    throw new Error(`Connector/${connectorName} (connection=${connectionName})가 시작 직후 종료되었습니다.`);
  }

  throw new Error(
    `Connector/${connectorName} (connection=${connectionName}) 시작 실패: ${unknownToErrorMessage(outcome.error)}`,
  );
}

function monitorConnectorExit(connectionName: string, connectorName: string, execution: Promise<void>): void {
  void execution
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(
        `[goondan-runtime][${connectionName}/${connectorName}] connector child failed: ${unknownToErrorMessage(error)}`,
      );
      process.exit(1);
    });
}

function sendStartedMessage(): void {
  const message: ConnectorChildStartedMessage = {
    type: 'connector_started',
  };
  sendMessage(message);
}

function sendStartErrorMessage(messageText: string): void {
  const message: ConnectorChildStartErrorMessage = {
    type: 'connector_start_error',
    message: messageText,
  };
  sendMessage(message);
}

function shutdownChild(): void {
  shutdownRequested = true;
  process.exit(0);
}

async function startConnector(message: unknown): Promise<void> {
  if (!isConnectorChildStartMessage(message)) {
    sendStartErrorMessage('connector_start 메시지 형식이 올바르지 않습니다.');
    process.exit(1);
    return;
  }

  if (runningConnector) {
    sendStartErrorMessage('Connector child는 하나의 connector만 실행할 수 있습니다.');
    process.exit(1);
    return;
  }

  const logger = createConnectorLogger(message.connectionName, message.connectorName);
  const context: ConnectorContext = {
    emit: async (event): Promise<void> => {
      const eventMessage: ConnectorChildEventMessage = {
        type: 'connector_event',
        event,
      };
      sendMessage(eventMessage);
    },
    config: message.config,
    secrets: message.secrets,
    logger,
  };

  try {
    const runConnector = await importConnectorRunner(message.connectorEntryPath);
    const execution = runConnector(context);
    await probeConnectorStartup(message.connectionName, message.connectorName, execution);

    runningConnector = {
      connectionName: message.connectionName,
      connectorName: message.connectorName,
      execution,
    };
    sendStartedMessage();
    monitorConnectorExit(message.connectionName, message.connectorName, execution);
  } catch (error) {
    sendStartErrorMessage(unknownToErrorMessage(error));
    process.exit(1);
  }
}

function onIpcMessage(message: unknown): void {
  if (isConnectorChildShutdownMessage(message)) {
    shutdownChild();
    return;
  }

  if (isConnectorChildStartMessage(message)) {
    void startConnector(message);
  }
}

process.on('message', onIpcMessage);
process.once('SIGINT', shutdownChild);
process.once('SIGTERM', shutdownChild);

if (!shutdownRequested) {
  setTimeout(() => {
    if (!runningConnector) {
      sendStartErrorMessage('connector_start 메시지를 받지 못했습니다.');
      process.exit(1);
    }
  }, 5_000);
}
