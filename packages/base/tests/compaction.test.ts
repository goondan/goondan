import { describe, it, expect } from 'vitest';
import { compactBlocks } from '../src/extensions/compaction/index.js';

describe('compaction extension', () => {
  it('compresses long text', async () => {
    const text = 'A '.repeat(2000);
    const result = compactBlocks([{ type: 'input', content: text }], 100);
    expect(result.length).toBeLessThanOrEqual(103);
  });
});
