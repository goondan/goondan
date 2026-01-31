interface CompactionInput {
  text?: string;
  blocks?: Array<{ type?: string; content?: string }>;
  maxChars?: number;
}

export const handlers = {
  'compaction.compress': async (_ctx: unknown, input: CompactionInput) => {
    const maxChars = input.maxChars ?? 2000;
    const text = input.text || flattenBlocks(input.blocks || []);

    if (!text) {
      return { content: '' };
    }

    if (text.length <= maxChars) {
      return { content: text, truncated: false };
    }

    const summarized = summarize(text, maxChars);
    return { content: summarized, truncated: true };
  },
};

function flattenBlocks(blocks: Array<{ type?: string; content?: string }>): string {
  return blocks
    .map((block) => block.content || '')
    .filter((value) => value.trim().length > 0)
    .join('\n\n');
}

function summarize(text: string, maxChars: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let output = '';
  for (const sentence of sentences) {
    if (output.length + sentence.length + 1 > maxChars) break;
    output += (output ? ' ' : '') + sentence;
  }
  if (output.length === 0) {
    output = text.slice(0, Math.max(0, maxChars - 3));
  }
  return `${output}...`;
}
