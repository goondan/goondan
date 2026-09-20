import { describe, expect, it } from 'vitest';
import { parseRunInput } from '../src/run-input.js';

describe('parseRunInput', () => {
  it('일반 텍스트와 JSON 문자열을 문자열 입력으로 넘긴다', () => {
    expect(parseRunInput('hello')).toBe('hello');
    expect(parseRunInput('"hello"')).toBe('hello');
  });

  it('객체와 배열 JSON을 구조를 보존한 채 넘긴다', () => {
    expect(parseRunInput('{"topic":"routes"}')).toEqual({ topic: 'routes' });
    expect(parseRunInput('[{"type":"text","text":"hello"}]')).toEqual([{ type: 'text', text: 'hello' }]);
    expect(parseRunInput('[{"id":"m1","role":"user","source":"cli","content":[]}]')).toEqual([
      { id: 'm1', role: 'user', source: 'cli', content: [] },
    ]);
  });
});
