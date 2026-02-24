import { describe, expect, it } from 'vitest';
import {
  createBaseConnectionManifest,
  createBaseConnectorManifests,
  createBaseExtensionManifests,
  createBaseManifestSet,
  createBaseToolManifests,
} from '../src/manifests/index.js';

describe('manifest helpers', () => {
  it('creates base tool/extension/connector manifests', () => {
    const tools = createBaseToolManifests();
    const extensions = createBaseExtensionManifests();
    const connectors = createBaseConnectorManifests();

    expect(tools.length).toBe(10);
    expect(extensions.length).toBe(7);
    expect(connectors.length).toBe(6);

    expect(tools.every((item) => item.kind === 'Tool')).toBe(true);
    expect(extensions.every((item) => item.kind === 'Extension')).toBe(true);
    expect(connectors.every((item) => item.kind === 'Connector')).toBe(true);
    expect(tools.some((item) => item.metadata.name === 'telegram')).toBe(true);
    expect(tools.some((item) => item.metadata.name === 'slack')).toBe(true);
    expect(tools.some((item) => item.metadata.name === 'self-restart')).toBe(true);
    expect(tools.some((item) => item.metadata.name === 'wait')).toBe(true);
    expect(extensions.some((item) => item.metadata.name === 'message-compaction')).toBe(true);
    expect(extensions.some((item) => item.metadata.name === 'message-window')).toBe(true);
    expect(extensions.some((item) => item.metadata.name === 'context-message')).toBe(true);
    expect(extensions.some((item) => item.metadata.name === 'inter-agent-response-format')).toBe(true);
    expect(
      connectors.some((item) => item.metadata.name === 'telegram-polling')
    ).toBe(true);

    const extensionNames = extensions.map((item) => item.metadata.name);
    const extensionEntries = extensions.map((item) => item.spec.entry);
    expect(new Set(extensionNames).size).toBe(extensionNames.length);
    expect(new Set(extensionEntries).size).toBe(extensionEntries.length);

    const contextMessage = extensions.find(
      (item) => item.metadata.name === 'context-message'
    );
    expect(contextMessage?.spec.entry).toBe('./src/extensions/context-message.ts');
    expect(contextMessage?.spec.config?.includeAgentPrompt).toBe(true);
    expect(contextMessage?.spec.config?.includeSwarmCatalog).toBe(false);
    expect(contextMessage?.spec.config?.includeRouteSummary).toBe(false);
  });

  it('creates connection sample with ingress rule', () => {
    const connection = createBaseConnectionManifest({
      connectorName: 'webhook',
      swarmName: 'ops',
      eventName: 'webhook_message',
      agentName: 'router',
    });

    expect(connection.kind).toBe('Connection');
    expect(connection.spec.connectorRef).toBe('Connector/webhook');
    expect(connection.spec.swarmRef).toBe('Swarm/ops');

    const firstRule = connection.spec.ingress?.rules?.[0];
    expect(firstRule?.match?.event).toBe('webhook_message');
    expect(firstRule?.route.agentRef).toBe('Agent/router');
  });

  it('creates aggregate manifest set', () => {
    const manifests = createBaseManifestSet();
    expect(manifests.length).toBe(24);

    const manifestIdentities = manifests.map((item) => `${item.kind}/${item.metadata.name}`);
    expect(new Set(manifestIdentities).size).toBe(manifestIdentities.length);
  });
});
