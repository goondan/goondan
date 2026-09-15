import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse.ts";

function parse(chunks: Array<string | Uint8Array>): string[] {
  const parser = new SseParser();
  const encoder = new TextEncoder();
  const events: string[] = [];
  for (const chunk of chunks) events.push(...parser.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk));
  events.push(...parser.end());
  return events;
}

describe("SseParser", () => {
  it("ends lines on CRLF, LF and CR", () => {
    expect(parse(["data: a\r\n\r\ndata: b\n\ndata: c\r\rdata: d\n\n"])).toEqual(["a", "b", "c", "d"]);
  });

  it("treats a CR at the end of a chunk and an LF at the start of the next as one line ending", () => {
    expect(parse(["data: a\r", "\ndata: b\n\n"])).toEqual(["a\nb"]);
    expect(parse(["data: a\r", "\n\r", "\ndata: b\r", "\r"])).toEqual(["a", "b"]);
  });

  it("decodes UTF-8 characters split across chunks, even byte by byte", () => {
    const bytes = new TextEncoder().encode('data: {"t":"안녕 😀"}\n\n');
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < bytes.length; index += 1) chunks.push(bytes.slice(index, index + 1));
    expect(parse(chunks)).toEqual(['{"t":"안녕 😀"}']);
  });

  it("skips comments, joins data lines with LF and ignores event, id and retry fields", () => {
    expect(parse([": keep-alive\n\nevent: message\nid: 7\nretry: 10\ndata: {\"a\":\ndata: 1}\n\n"])).toEqual(['{"a":\n1}']);
  });

  it("removes only one leading space from the value and accepts a field without a colon", () => {
    expect(parse(["data:x\n\ndata:  y\n\ndata\n\n"])).toEqual(["x", " y", ""]);
  });

  it("dispatches a last event that has no blank line after it", () => {
    expect(parse(["data: last"])).toEqual(["last"]);
    expect(parse(["data: last\r"])).toEqual(["last"]);
  });

  it("dispatches nothing for events without data", () => {
    expect(parse(["event: ping\n\n: comment\n\n"])).toEqual([]);
  });
});
