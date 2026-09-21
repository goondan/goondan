import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fold,
  StoreConflictError,
  StoreInputError,
  type JournalEvent,
  type Message,
  type NewJournalEvent,
  type StoreLease,
} from '@goondan/core';
import { describe, expect, it } from 'vitest';
import { FileJournalStore } from '../src/chat/session.js';

function message(id: string, text: string): Message {
  return { id, role: 'user', source: 'main', content: [{ type: 'text', text }] };
}

function event(sessionId: string, id: string, text: string): NewJournalEvent {
  return {
    version: 1,
    type: 'conversation.message.appended',
    sessionId,
    agent: 'main',
    instance: `${sessionId}/main`,
    turnId: 'turn-1',
    executionId: 'execution-1',
    data: { message: message(id, text) },
  };
}

async function sessionRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'gdn-session-'));
}

function sessionPath(root: string, sessionId: string): string {
  return join(root, 'sessions', `${encodeURIComponent(sessionId)}.jsonl`);
}

async function lease(store: FileJournalStore, sessionId: string, owner = 'test'): Promise<StoreLease> {
  const acquired = await store.acquireLease(sessionId, owner);
  if (!acquired) throw new Error('Expected the lease to be acquired');
  return acquired;
}

async function events(store: FileJournalStore, sessionId: string): Promise<JournalEvent[]> {
  const found: JournalEvent[] = [];
  for await (const item of store.scan({ sessionId })) found.push(item);
  return found;
}

describe('FileJournalStore', () => {
  it('append 배치에 연속 번호를 붙이고 완전한 JSONL 봉투를 기록한다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const held = await lease(store, 'keys');
    const stored = await store.append([
      event('keys', 'a', 'first'),
      event('keys', 'b', 'second'),
    ], { expected: 0, token: held.token, writeId: 'write-1' });

    expect(stored.map((item) => item.seq)).toEqual([1, 2]);
    expect(stored.every((item) => item.writeId === 'write-1' && item.at > 0)).toBe(true);
    const lines = (await readFile(sessionPath(root, 'keys'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual(stored);
    expect(await store.head('keys')).toBe(2);
    await held.release();
  });

  it('writeId 재시도는 최초 결과를 반환하고 expected 충돌은 기록하지 않는다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const held = await lease(store, 'idempotent');
    const first = await store.append([event('idempotent', 'a', 'first')], {
      expected: 0, token: held.token, writeId: 'same-write',
    });
    const retried = await store.append([event('idempotent', 'different', 'ignored')], {
      expected: 99, token: held.token, writeId: 'same-write',
    });
    expect(retried).toEqual(first);
    await expect(store.append([event('idempotent', 'b', 'second')], {
      expected: 0, token: held.token, writeId: 'conflict',
    })).rejects.toBeInstanceOf(StoreConflictError);
    expect(await store.head('idempotent')).toBe(1);
    await held.release();
  });

  it('같은 expected로 동시에 기록하면 한 배치만 성공한다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const held = await lease(store, 'concurrent');
    const results = await Promise.allSettled([
      store.append([event('concurrent', 'a', 'first')], { expected: 0, token: held.token, writeId: 'left' }),
      store.append([event('concurrent', 'b', 'second')], { expected: 0, token: held.token, writeId: 'right' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toBeInstanceOf(StoreConflictError);
    expect(await store.head('concurrent')).toBe(1);
    await held.release();
  });

  it('형식이 잘못된 이벤트 배치는 일부도 기록하지 않는다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const held = await lease(store, 'invalid');
    const invalid = event('invalid', 'a', 'first');
    invalid.data = {};
    await expect(store.append([invalid], {
      expected: 0, token: held.token, writeId: 'invalid-write',
    })).rejects.toBeInstanceOf(StoreInputError);
    expect(await store.head('invalid')).toBe(0);
    await held.release();
  });

  it('새 임대가 발급되면 이전 펜싱 토큰의 append와 삭제를 거부한다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const first = await lease(store, 'fencing', 'first');
    await first.release();
    const second = await lease(store, 'fencing', 'second');
    expect(second.token).toBeGreaterThan(first.token);
    await expect(store.append([event('fencing', 'a', 'late')], {
      expected: 0, token: first.token, writeId: 'late',
    })).rejects.toBeInstanceOf(StoreConflictError);
    await expect(store.deleteSession('fencing', { token: first.token })).rejects.toBeInstanceOf(StoreConflictError);
    await second.release();
  });

  it('재시작한 저장소가 JSONL을 재생해 같은 fold 상태를 만든다', async () => {
    const root = await sessionRoot();
    const first = new FileJournalStore(root);
    const held = await lease(first, 'replay');
    await first.append([
      event('replay', 'a', 'first'),
      event('replay', 'b', 'second'),
    ], { expected: 0, token: held.token, writeId: 'replay-write' });
    await held.release();

    const reopened = new FileJournalStore(root);
    const state = fold('replay', await events(reopened, 'replay'));
    expect(state.head).toBe(2);
    expect(state.conversations[0]?.messages).toEqual([message('a', 'first'), message('b', 'second')]);
  });

  it('삭제는 스트림을 제거하고 다음 임대의 펜싱 세대를 유지한다', async () => {
    const root = await sessionRoot();
    const store = new FileJournalStore(root);
    const first = await lease(store, 'delete');
    await store.append([event('delete', 'a', 'value')], { expected: 0, token: first.token, writeId: 'delete-write' });
    await store.deleteSession('delete', { token: first.token });

    await expect(access(sessionPath(root, 'delete'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.head('delete')).toBe(0);
    expect(await first.renew()).toBe(false);
    const second = await lease(store, 'delete', 'after-delete');
    expect(second.token).toBeGreaterThan(first.token);
    await expect(store.append([event('delete', 'late', 'stale')], {
      expected: 0, token: first.token, writeId: 'stale-write',
    })).rejects.toBeInstanceOf(StoreConflictError);
    await second.release();
  });

  it('손상된 JSONL 세션을 거부한다', async () => {
    const root = await sessionRoot();
    await mkdir(join(root, 'sessions'), { recursive: true });
    await writeFile(sessionPath(root, 'broken'), '{"not":"an event"}\n', 'utf8');
    const store = new FileJournalStore(root);
    await expect(store.head('broken')).rejects.toThrow('Invalid chat journal');
  });
});
