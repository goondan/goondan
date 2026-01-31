import { describe, it, expect } from 'vitest';
import { handlers } from '../src/tools/compaction/index.js';

describe('compaction tool', () => {
  it('compresses long text', async () => {
    const text = 'A '.repeat(2000);
    const result = await handlers['compaction.compress']({}, { text, maxChars: 100 });
    expect((result as { content: string }).content.length).toBeLessThanOrEqual(103);
  });
});
