const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/**
 * Incremental server-sent events parser that returns the `data` of each finished event.
 *
 * - Body chunks are decoded as one UTF-8 stream, so a character may be split across chunks.
 * - Lines end with `\r\n`, `\n` or `\r`; a chunk ending in `\r` waits for the next chunk.
 * - Lines starting with `:` are comments. Multiple `data` lines are joined with `\n`.
 *   `event`, `id` and `retry` fields are ignored.
 * - A blank line ends an event. `end()` also dispatches a last event that has no blank line after it.
 */
export class SseParser {
  readonly #decoder = new TextDecoder("utf-8");
  #buffer = "";
  #data: string[] = [];

  push(chunk: Uint8Array): string[] {
    return this.#consume(this.#decoder.decode(chunk, { stream: true }), false);
  }

  end(): string[] {
    return this.#consume(this.#decoder.decode(), true);
  }

  #consume(text: string, final: boolean): string[] {
    const events: string[] = [];
    const previous = this.#buffer;
    const buffer = previous + text;
    // The kept buffer holds no line break except possibly a trailing `\r`.
    let index = previous.endsWith("\r") ? previous.length - 1 : previous.length;
    let start = 0;
    while (index < buffer.length) {
      const code = buffer.charCodeAt(index);
      if (code !== LINE_FEED && code !== CARRIAGE_RETURN) {
        index += 1;
        continue;
      }
      if (code === CARRIAGE_RETURN && index + 1 === buffer.length && !final) break;
      this.#line(buffer.slice(start, index), events);
      index += code === CARRIAGE_RETURN && buffer.charCodeAt(index + 1) === LINE_FEED ? 2 : 1;
      start = index;
    }
    this.#buffer = buffer.slice(start);
    if (final) {
      if (this.#buffer !== "") this.#line(this.#buffer, events);
      this.#buffer = "";
      this.#dispatch(events);
    }
    return events;
  }

  #line(line: string, events: string[]): void {
    if (line === "") {
      this.#dispatch(events);
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    const value = colon === -1 ? "" : line.slice(colon + 1);
    this.#data.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  #dispatch(events: string[]): void {
    if (this.#data.length === 0) return;
    events.push(this.#data.join("\n"));
    this.#data = [];
  }
}
