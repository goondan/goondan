import type { Runtime } from '../runtime/runtime.js';
import type { Resource } from '../config/registry.js';

export interface ConnectorAdapter {
  handleEvent: (payload: Record<string, unknown>) => Promise<void>;
  postMessage?: (input: { channel: string; text: string; threadTs?: string; origin?: Record<string, unknown>; auth?: Record<string, unknown> }) => Promise<unknown>;
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

  createConnector(type: string, options: Parameters<ConnectorFactory>[0]): ConnectorAdapter | null {
    const factory = this.adapters.get(type);
    if (!factory) return null;
    return factory(options);
  }
}
