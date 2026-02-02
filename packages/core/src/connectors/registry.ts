import type { Runtime } from '../runtime/runtime.js';
import type { Resource } from '../config/registry.js';
import type { JsonObject } from '../sdk/types.js';

export interface ConnectorAdapter {
  handleEvent: (payload: JsonObject) => Promise<void>;
  send?: (input: ConnectorEgressInput) => Promise<unknown>;
  /** Long-running 커넥터 시작 (polling, webhook 등) */
  start?: () => Promise<void>;
  /** 커넥터 종료 */
  stop?: () => Promise<void>;
}

export interface ConnectorEgressInput {
  text: string;
  origin?: JsonObject;
  auth?: JsonObject;
  metadata?: JsonObject;
  kind?: 'progress' | 'final';
}

export type ConnectorFactory = (options: {
  runtime: Runtime;
  connectorConfig: Resource;
  logger?: Console;
}) => ConnectorAdapter;

export class ConnectorRegistry {
  private adapters: Map<string, ConnectorFactory> = new Map();

  registerAdapter(type: string, factory: ConnectorFactory): void {
    this.adapters.set(type, factory);
  }

  hasAdapter(type: string): boolean {
    return this.adapters.has(type);
  }

  createConnector(type: string, options: Parameters<ConnectorFactory>[0]): ConnectorAdapter | null {
    const factory = this.adapters.get(type);
    if (!factory) return null;
    return factory(options);
  }
}
