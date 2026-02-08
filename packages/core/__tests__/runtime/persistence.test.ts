import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager } from '../../src/workspace/manager.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentInstance } from '../../src/runtime/agent-instance.js';
import { createRuntimePersistenceBindings } from '../../src/runtime/persistence.js';
import type { ExtensionResource } from '../../src/types/specs/extension.js';

describe('Runtime persistence wiring', () => {
  let tempDir: string;
  let stateRoot: string;
  let bundleRoot: string;
  let workspaceManager: WorkspaceManager;
  let swarmInstance: ReturnType<typeof createSwarmInstance>;
  let agentInstance: ReturnType<typeof createAgentInstance>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-runtime-persistence-'));
    stateRoot = path.join(tempDir, '.goondan');
    bundleRoot = path.join(tempDir, 'bundle');
    await fs.mkdir(bundleRoot, { recursive: true });

    workspaceManager = WorkspaceManager.create({
      stateRoot,
      swarmBundleRoot: bundleRoot,
    });

    swarmInstance = createSwarmInstance(
      'Swarm/default',
      'cli',
      'bundle-ref'
    );
    agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    await workspaceManager.initializeInstanceState(swarmInstance.id, [agentInstance.agentName]);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('message logger/recovery를 Runtime 바인딩으로 연결해야 한다', async () => {
    const bindings = createRuntimePersistenceBindings(workspaceManager);
    const logger = bindings.messageStateLogger(agentInstance);

    await logger.base.appendDelta({
      traceId: 'trace-1',
      instanceId: swarmInstance.id,
      instanceKey: swarmInstance.instanceKey,
      agentName: agentInstance.agentName,
      turnId: 'turn-1',
      startSeq: 0,
      messages: [{ id: 'msg-base', role: 'user', content: 'base' }],
    });

    await logger.events.log({
      traceId: 'trace-2',
      instanceId: swarmInstance.id,
      instanceKey: swarmInstance.instanceKey,
      agentName: agentInstance.agentName,
      turnId: 'turn-2',
      seq: 0,
      eventType: 'llm_message',
      payload: {
        message: {
          id: 'msg-event',
          role: 'assistant',
          content: 'event',
        },
      },
    });

    const recovered = await bindings.messageStateRecovery(agentInstance);
    expect(recovered).toBeDefined();
    expect(recovered?.baseMessages).toEqual([
      { id: 'msg-base', role: 'user', content: 'base' },
    ]);
    expect(recovered?.events).toHaveLength(1);
    expect(recovered?.events[0]).toMatchObject({
      type: 'llm_message',
      seq: 0,
    });
  });

  it('ExtensionLoader 생성 시 persistent state store가 주입되어 자동 복원/영속화되어야 한다', async () => {
    await workspaceManager.writeExtensionState(swarmInstance.id, 'extA', { count: 1 });
    await workspaceManager.writeExtensionSharedState(swarmInstance.id, { mode: 'cold' });

    const bindings = createRuntimePersistenceBindings(workspaceManager);
    const eventBus = {
      emit: (_event: string, _data?: unknown) => {},
      on: (_event: string, _handler: (data: unknown) => void) => () => {},
    };
    const loader = await bindings.createExtensionLoader(agentInstance, eventBus);

    const extension: ExtensionResource = {
      apiVersion: 'goondan.io/v1alpha1',
      kind: 'Extension',
      metadata: { name: 'extA' },
      spec: {
        runtime: 'node',
        entry: './extensions/extA/index.ts',
      },
    };

    let restoredCount = -1;
    await loader.loadExtension(extension, (api) => {
      const state = api.getState();
      const countValue = state['count'];
      restoredCount = typeof countValue === 'number' ? countValue : 0;

      api.setState({ count: restoredCount + 1 });
      api.instance.shared['mode'] = 'warm';
    });
    await bindings.flushExtensionState(agentInstance);

    expect(restoredCount).toBe(1);
    const extensionState = await workspaceManager.readExtensionState(swarmInstance.id, 'extA');
    const sharedState = await workspaceManager.readExtensionSharedState(swarmInstance.id);

    expect(extensionState).toEqual({ count: 2 });
    expect(sharedState).toEqual({ mode: 'warm' });
  });
});
