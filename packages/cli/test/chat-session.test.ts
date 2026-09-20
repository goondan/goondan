import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@goondan/core';
import { describe, expect, it } from 'vitest';
import { FileConversationStore } from '../src/chat/session.js';

function message(id: string, text: string): Message {
  return { id, role: 'user', source: 'host', content: [{ type: 'text', text }] };
}

async function sessionRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'gdn-session-'));
}

function sessionPath(root: string, sessionId: string): string {
  return join(root, 'sessions', `${encodeURIComponent(sessionId)}.json`);
}

async function readSession(root: string, sessionId: string): Promise<unknown> {
  return JSON.parse(await readFile(sessionPath(root, sessionId), 'utf8'));
}

describe('FileConversationStore', () => {
  it('세션 식별자와 에이전트 이름별로 기록을 나눈다', async () => {
    const root = await sessionRoot();
    const store = new FileConversationStore(root, 'keys');
    await store.append('keys', 'main', [message('a', 'first')]);
    await store.append('keys', 'helper', [message('b', 'second')]);
    await store.append('keys#turn-1#helper', 'main', [message('c', 'derived')]);

    expect(await store.load('keys', 'main')).toEqual([message('a', 'first')]);
    expect(await store.load('keys', 'helper')).toEqual([message('b', 'second')]);
    expect(await store.load('keys#turn-1#helper', 'main')).toEqual([message('c', 'derived')]);
    expect(await store.load('keys', 'missing')).toEqual([]);
    expect(await readSession(root, 'keys')).toEqual({
      version: 1,
      agents: { main: [message('a', 'first')], helper: [message('b', 'second')] },
    });
    expect(await readSession(root, 'keys#turn-1#helper')).toEqual({
      version: 1,
      agents: { main: [message('c', 'derived')] },
    });
  });

  it('replace는 해당 대화의 에이전트 기록만 교체한다', async () => {
    const root = await sessionRoot();
    const store = new FileConversationStore(root, 'replace');
    await store.append('replace', 'main', [message('a', 'first')]);
    await store.append('other', 'main', [message('b', 'other')]);
    await store.replace('replace', 'main', [message('c', 'only')]);
    expect(await store.load('replace', 'main')).toEqual([message('c', 'only')]);
    expect(await store.load('other', 'main')).toEqual([message('b', 'other')]);
  });

  it('세션과 파생 세션 파일을 함께 삭제한다', async () => {
    const root = await sessionRoot();
    const store = new FileConversationStore(root, 'delete');
    await store.append('delete', 'main', [message('a', 'base')]);
    await store.append('delete#turn-1#helper', 'helper', [message('b', 'derived')]);
    await store.append('keep', 'main', [message('c', 'keep')]);

    await store.deleteSession('delete');

    await expect(access(sessionPath(root, 'delete'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(sessionPath(root, 'delete#turn-1#helper'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readSession(root, 'keep')).toEqual({ version: 1, agents: { main: [message('c', 'keep')] } });
  });

  it('형식이 맞지 않는 세션 파일을 거부한다', async () => {
    const root = await sessionRoot();
    await mkdir(join(root, 'sessions'), { recursive: true });
    await writeFile(sessionPath(root, 'broken'), JSON.stringify({ version: 2, conversations: {} }), 'utf8');
    const store = new FileConversationStore(root, 'broken');
    await expect(store.load('broken', 'main')).rejects.toThrow('Invalid chat session');
  });
});
