import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileWorkspaceStorage } from '../src/workspace/storage.js';
import { WorkspacePaths } from '../src/workspace/paths.js';
import type { Message, MessageEvent } from '../src/types.js';

describe('FileWorkspaceStorage', () => {
  let tmpDir: string;
  let storage: FileWorkspaceStorage;
  let paths: WorkspacePaths;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    paths = new WorkspacePaths({
      stateRoot: tmpDir,
      projectRoot: tmpDir,
      workspaceName: 'test-workspace',
    });
    storage = new FileWorkspaceStorage(paths);
    await storage.initializeSystemRoot();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('delta append optimization (spec §7.3.1, §2.4)', () => {
    it('append-only 이벤트만 있으면 delta append를 사용한다', async () => {
      const instanceKey = 'test:user1';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      // Initial messages
      const initialMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Hello' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
        {
          id: 'm2',
          data: { role: 'assistant', content: 'Hi!' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:01Z'),
          source: { type: 'assistant', stepId: 's1' },
        },
      ];

      // Write initial base
      await storage.writeBaseMessages(instanceKey, initialMessages);

      // Read base file size
      const basePath = paths.instanceMessageBasePath(instanceKey);
      const beforeStat = await fs.stat(basePath);
      const beforeContent = await fs.readFile(basePath, 'utf8');
      const beforeLines = beforeContent.trim().split('\n');
      expect(beforeLines).toHaveLength(2);

      // Append new messages (simulate events)
      const newMessage: Message = {
        id: 'm3',
        data: { role: 'user', content: 'How are you?' },
        metadata: {},
        createdAt: new Date('2026-02-01T00:00:02Z'),
        source: { type: 'user' },
      };

      const appendEvent: MessageEvent = {
        type: 'append',
        message: newMessage,
      };

      const finalMessages = [...initialMessages, newMessage];

      // Write with delta append (append-only event)
      await storage.writeBaseMessages(instanceKey, finalMessages, initialMessages, [appendEvent]);

      // Verify: base file should be appended, not rewritten
      const afterContent = await fs.readFile(basePath, 'utf8');
      const afterLines = afterContent.trim().split('\n');
      expect(afterLines).toHaveLength(3);

      // Verify content correctness
      expect(afterLines[0]).toContain('"id":"m1"');
      expect(afterLines[1]).toContain('"id":"m2"');
      expect(afterLines[2]).toContain('"id":"m3"');
    });

    it('mutation 이벤트가 있으면 full rewrite를 사용한다', async () => {
      const instanceKey = 'test:user2';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      const initialMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Original' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
      ];

      await storage.writeBaseMessages(instanceKey, initialMessages);

      // Replace event (mutation)
      const replacedMessage: Message = {
        id: 'm1-v2',
        data: { role: 'user', content: 'Updated' },
        metadata: {},
        createdAt: new Date('2026-02-01T00:00:01Z'),
        source: { type: 'extension', extensionName: 'compaction' },
      };

      const replaceEvent: MessageEvent = {
        type: 'replace',
        targetId: 'm1',
        message: replacedMessage,
      };

      const finalMessages = [replacedMessage];

      // Write with full rewrite (mutation detected)
      await storage.writeBaseMessages(instanceKey, finalMessages, initialMessages, [replaceEvent]);

      // Verify: content is rewritten
      const basePath = paths.instanceMessageBasePath(instanceKey);
      const content = await fs.readFile(basePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('"id":"m1-v2"');
      expect(lines[0]).toContain('"content":"Updated"');
    });

    it('remove 이벤트가 있으면 full rewrite를 사용한다', async () => {
      const instanceKey = 'test:user3';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      const initialMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Message 1' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
        {
          id: 'm2',
          data: { role: 'user', content: 'Message 2' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:01Z'),
          source: { type: 'user' },
        },
      ];

      await storage.writeBaseMessages(instanceKey, initialMessages);

      // Remove event (mutation)
      const removeEvent: MessageEvent = {
        type: 'remove',
        targetId: 'm1',
      };

      const finalMessages = initialMessages.filter((m) => m.id !== 'm1');

      // Write with full rewrite (mutation detected)
      await storage.writeBaseMessages(instanceKey, finalMessages, initialMessages, [removeEvent]);

      // Verify: only m2 remains
      const basePath = paths.instanceMessageBasePath(instanceKey);
      const content = await fs.readFile(basePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('"id":"m2"');
    });

    it('truncate 이벤트가 있으면 full rewrite를 사용한다', async () => {
      const instanceKey = 'test:user4';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      const initialMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Message 1' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
      ];

      await storage.writeBaseMessages(instanceKey, initialMessages);

      // Truncate event (mutation)
      const truncateEvent: MessageEvent = {
        type: 'truncate',
      };

      const finalMessages: Message[] = [];

      // Write with full rewrite (mutation detected)
      await storage.writeBaseMessages(instanceKey, finalMessages, initialMessages, [truncateEvent]);

      // Verify: base is empty
      const basePath = paths.instanceMessageBasePath(instanceKey);
      const content = await fs.readFile(basePath, 'utf8');
      expect(content.trim()).toBe('');
    });
  });

  describe('foldEventsToBase', () => {
    it('events를 base로 폴딩하고 events를 클리어한다 (spec §7.3.3)', async () => {
      const instanceKey = 'test:user5';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      // Write initial base
      const initialMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Hello' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
      ];
      await storage.writeBaseMessages(instanceKey, initialMessages);

      // Append event
      const newMessage: Message = {
        id: 'm2',
        data: { role: 'assistant', content: 'Hi!' },
        metadata: {},
        createdAt: new Date('2026-02-01T00:00:01Z'),
        source: { type: 'assistant', stepId: 's1' },
      };
      await storage.appendMessageEvent(instanceKey, {
        type: 'append',
        message: newMessage,
      });

      // Fold events to base
      await storage.foldEventsToBase(instanceKey);

      // Verify: base contains both messages
      const loaded = await storage.loadConversation(instanceKey);
      expect(loaded.baseMessages).toHaveLength(2);
      expect(loaded.baseMessages[0].id).toBe('m1');
      expect(loaded.baseMessages[1].id).toBe('m2');

      // Verify: events is cleared
      expect(loaded.events).toHaveLength(0);

      // Verify: nextMessages is the same as baseMessages
      expect(loaded.nextMessages).toHaveLength(2);
      expect(loaded.nextMessages[0].id).toBe('m1');
      expect(loaded.nextMessages[1].id).toBe('m2');
    });
  });

  describe('loadConversation', () => {
    it('base + events를 합성하여 복원한다 (spec §2.4)', async () => {
      const instanceKey = 'test:user6';
      await storage.initializeInstanceState(instanceKey, 'test-agent');

      // Write base
      const baseMessages: Message[] = [
        {
          id: 'm1',
          data: { role: 'user', content: 'Hello' },
          metadata: {},
          createdAt: new Date('2026-02-01T00:00:00Z'),
          source: { type: 'user' },
        },
      ];
      await storage.writeBaseMessages(instanceKey, baseMessages);

      // Append events (simulate in-progress Turn)
      const newMessage: Message = {
        id: 'm2',
        data: { role: 'assistant', content: 'Hi!' },
        metadata: {},
        createdAt: new Date('2026-02-01T00:00:01Z'),
        source: { type: 'assistant', stepId: 's1' },
      };
      await storage.appendMessageEvent(instanceKey, {
        type: 'append',
        message: newMessage,
      });

      // Load conversation
      const loaded = await storage.loadConversation(instanceKey);

      // Verify: nextMessages = baseMessages + SUM(events)
      expect(loaded.baseMessages).toHaveLength(1);
      expect(loaded.events).toHaveLength(1);
      expect(loaded.nextMessages).toHaveLength(2);
      expect(loaded.nextMessages[0].id).toBe('m1');
      expect(loaded.nextMessages[1].id).toBe('m2');
    });
  });
});
