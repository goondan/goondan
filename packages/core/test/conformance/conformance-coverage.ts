/**
 * Spec heading coverage.
 *
 * Every `##`, `###` and `####` heading of spec/goondan.md must be cited by at
 * least one case, every citation must name an existing heading, and the spec
 * must not repeat a heading. See fixtures/conformance/README.md
 * ("규격 절 인용과 검증 범위").
 */

export interface SpecHeading {
  level: number;
  title: string;
  line: number;
}

/** Headings of level 2 to 4, ignoring fenced code blocks. */
export function parseSpecHeadings(markdown: string): SpecHeading[] {
  const headings: SpecHeading[] = [];
  let fence: string | undefined;
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (marker === undefined) continue;
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const hashes = match[1];
    const title = match[2];
    if (hashes === undefined || title === undefined) continue;
    headings.push({ level: hashes.length, title, line: index + 1 });
  }
  return headings;
}

export interface CoverageInput {
  headings: readonly SpecHeading[];
  /** Case identifier to the headings that case cites. */
  citations: ReadonlyMap<string, readonly string[]>;
}

/** Returns one message per coverage problem; an empty array means covered. */
export function checkCoverage(input: CoverageInput): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const heading of input.headings) counts.set(heading.title, (counts.get(heading.title) ?? 0) + 1);
  for (const [title, count] of counts) {
    if (count > 1) problems.push(`spec/goondan.md repeats the heading "${title}" ${String(count)} times`);
  }
  const cited = new Map<string, string[]>();
  for (const [caseId, headings] of input.citations) {
    for (const heading of headings) {
      const list = cited.get(heading) ?? [];
      list.push(caseId);
      cited.set(heading, list);
    }
  }
  for (const [heading, cases] of cited) {
    if (counts.has(heading)) continue;
    problems.push(`case ${cases.sort().join(", ")} cites "${heading}", which is not a spec heading`);
  }
  for (const heading of input.headings) {
    if (cited.has(heading.title)) continue;
    problems.push(`spec heading "${heading.title}" (line ${String(heading.line)}) is not cited by any case`);
  }
  return problems;
}
