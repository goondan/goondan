import { describe, expect, it } from "vitest";
import { checkCoverage, parseSpecHeadings } from "./conformance-coverage.ts";

describe("parseSpecHeadings", () => {
  it("collects level 2 to 4 headings and skips the document title", () => {
    const headings = parseSpecHeadings("# Goondan\n\n## 에이전트\n\n### 도구\n\n#### `execution.complete`\n\n##### too deep\n");
    expect(headings).toEqual([
      { level: 2, title: "에이전트", line: 3 },
      { level: 3, title: "도구", line: 5 },
      { level: 4, title: "`execution.complete`", line: 7 },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const headings = parseSpecHeadings("## real\n\n```yaml\n## not a heading\n```\n\n## other\n");
    expect(headings.map((heading) => heading.title)).toEqual(["real", "other"]);
  });

  it("keeps trailing hashes out of the title but not inline backticks", () => {
    expect(parseSpecHeadings("## `flow` 선언  ")[0]?.title).toBe("`flow` 선언");
  });
});

describe("checkCoverage", () => {
  const headings = [
    { level: 2, title: "에이전트", line: 1 },
    { level: 3, title: "도구", line: 2 },
  ];

  it("passes when every heading is cited", () => {
    const citations = new Map([["basic", ["에이전트", "도구"]]]);
    expect(checkCoverage({ headings, citations })).toEqual([]);
  });

  it("reports headings no case cites", () => {
    const problems = checkCoverage({ headings, citations: new Map([["basic", ["에이전트"]]]) });
    expect(problems).toEqual(['spec heading "도구" (line 2) is not cited by any case']);
  });

  it("reports citations that are not spec headings", () => {
    const problems = checkCoverage({ headings, citations: new Map([["basic", ["에이전트", "도구", "없는 절"]]]) });
    expect(problems).toEqual(['case basic cites "없는 절", which is not a spec heading']);
  });

  it("reports repeated spec headings", () => {
    const repeated = [...headings, { level: 3, title: "도구", line: 9 }];
    const problems = checkCoverage({ headings: repeated, citations: new Map([["basic", ["에이전트", "도구"]]]) });
    expect(problems).toEqual(['spec/goondan.md repeats the heading "도구" 2 times']);
  });
});
