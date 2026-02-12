import { formatInstanceList } from '../formatter.js';
import type { CliDependencies, ExitCode, InstanceRecord, TerminalIO } from '../types.js';

export interface InstanceInteractiveGlobals {
  config: string;
  stateRoot?: string;
  json?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

interface InstanceInteractiveCommand {
  action: 'instance.interactive';
}

export interface InstanceInteractiveContext {
  cmd: InstanceInteractiveCommand;
  deps: CliDependencies;
  globals: InstanceInteractiveGlobals;
}

// ANSI escape sequences
const ESC = '\x1b';
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;

function cursorUp(n: number): string {
  return n > 0 ? `${ESC}[${n}A` : '';
}

function bold(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}[1m${text}${ESC}[0m`;
}

function dim(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}[2m${text}${ESC}[0m`;
}

function green(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}[32m${text}${ESC}[0m`;
}

function yellow(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}[33m${text}${ESC}[0m`;
}

function red(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}[31m${text}${ESC}[0m`;
}

function statusColor(status: string, noColor: boolean): string {
  if (status === 'running' || status === 'processing') return green(status, noColor);
  if (status === 'idle') return yellow(status, noColor);
  if (status === 'crashed' || status === 'terminated') return red(status, noColor);
  return status;
}

interface TuiState {
  items: InstanceRecord[];
  cursor: number;
  renderedLines: number;
}

function renderFrame(state: TuiState, terminal: TerminalIO, noColor: boolean): number {
  const lines: string[] = [];

  lines.push(bold('Instances', noColor) + dim('  (↑↓ 이동, Del 삭제, q/Esc 나가기)', noColor));
  lines.push('');

  for (let i = 0; i < state.items.length; i++) {
    const record = state.items[i];
    if (!record) continue;
    const selected = i === state.cursor;
    const prefix = selected ? '> ' : '  ';
    const bullet = selected ? '●' : '○';
    const line = `${prefix}${bullet} ${record.key}   ${record.agent}   ${statusColor(record.status, noColor)}`;
    lines.push(line);
  }

  const exitLabel = state.cursor === state.items.length ? '> 나가기' : '  나가기';
  lines.push(exitLabel);
  lines.push('');
  lines.push(dim(`${state.items.length} instance(s)`, noColor));

  // Move cursor up to overwrite previous frame
  if (state.renderedLines > 0) {
    terminal.write(cursorUp(state.renderedLines));
  }

  for (const line of lines) {
    terminal.write(`${CLEAR_LINE}${line}\n`);
  }

  return lines.length;
}

async function loadInstances(deps: CliDependencies, globals: InstanceInteractiveGlobals): Promise<InstanceRecord[]> {
  return deps.instances.list({
    limit: 100,
    all: false,
    stateRoot: globals.stateRoot ?? undefined,
  });
}

export async function handleInstanceInteractive({ deps, globals }: InstanceInteractiveContext): Promise<ExitCode> {
  const noColor = globals.noColor ?? false;
  const isJson = globals.json ?? false;

  // Non-TTY or --json: fall back to instance list
  if (!deps.terminal.stdinIsTTY || !deps.terminal.stdoutIsTTY || isJson) {
    const items = await deps.instances.list({
      limit: 20,
      all: false,
      stateRoot: globals.stateRoot,
    });
    deps.io.out(formatInstanceList(items));
    return 0;
  }

  const items = await loadInstances(deps, globals);

  // 인스턴스 0개
  if (items.length === 0) {
    deps.io.out('인스턴스가 없습니다.');
    return 0;
  }

  const terminal = deps.terminal;

  const state: TuiState = {
    items,
    cursor: 0,
    renderedLines: 0,
  };

  terminal.write(HIDE_CURSOR);
  state.renderedLines = renderFrame(state, terminal, noColor);

  return new Promise<ExitCode>((resolve) => {
    function cleanup(): void {
      terminal.write(SHOW_CURSOR);
      terminal.setRawMode(false);
      terminal.pause();
    }

    function exit(code: ExitCode): void {
      cleanup();
      resolve(code);
    }

    const onData = (data: Buffer): void => {
      const key = data.toString('utf8');

      // Ctrl+C
      if (key === '\x03') {
        terminal.offData(onData);
        exit(130);
        return;
      }

      // Esc (standalone, not part of escape sequence)
      if (key === ESC) {
        terminal.offData(onData);
        exit(0);
        return;
      }

      // q
      if (key === 'q') {
        terminal.offData(onData);
        exit(0);
        return;
      }

      // Enter — only on "나가기" row
      if (key === '\r') {
        if (state.cursor === state.items.length) {
          terminal.offData(onData);
          exit(0);
          return;
        }
      }

      // Arrow up
      if (key === `${ESC}[A`) {
        if (state.cursor > 0) {
          state.cursor--;
          state.renderedLines = renderFrame(state, terminal, noColor);
        }
        return;
      }

      // Arrow down
      if (key === `${ESC}[B`) {
        // items.length = last index is "나가기"
        if (state.cursor < state.items.length) {
          state.cursor++;
          state.renderedLines = renderFrame(state, terminal, noColor);
        }
        return;
      }

      // Delete key
      if (key === `${ESC}[3~`) {
        const target = state.cursor < state.items.length ? state.items[state.cursor] : undefined;
        if (target) {
          void (async () => {
            await deps.instances.delete({
              key: target.key,
              force: false,
              stateRoot: globals.stateRoot ?? undefined,
            });

            // Reload instances
            const newItems = await loadInstances(deps, globals);
            state.items = newItems;

            if (newItems.length === 0) {
              terminal.offData(onData);
              // Clear old frame and show message
              if (state.renderedLines > 0) {
                terminal.write(cursorUp(state.renderedLines));
                for (let i = 0; i < state.renderedLines; i++) {
                  terminal.write(`${CLEAR_LINE}\n`);
                }
                terminal.write(cursorUp(state.renderedLines));
              }
              terminal.write(SHOW_CURSOR);
              deps.io.out('모든 인스턴스가 삭제되었습니다.');
              terminal.setRawMode(false);
              terminal.pause();
              resolve(0);
              return;
            }

            // Adjust cursor if it's now out of bounds
            if (state.cursor >= newItems.length) {
              state.cursor = newItems.length - 1;
            }
            state.renderedLines = renderFrame(state, terminal, noColor);
          })();
        }
        return;
      }
    };

    terminal.setRawMode(true);
    terminal.resume();
    terminal.onData(onData);
  });
}
