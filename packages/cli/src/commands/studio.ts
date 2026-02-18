import { spawn } from 'node:child_process';
import { usageError } from '../errors.js';
import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type StudioCommand = Extract<GdnCommand, { action: 'studio' }>;

interface StudioContext {
  cmd: StudioCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface BrowserLauncher {
  command: string;
  args: string[];
}

type BrowserOpenMode = 'open' | 'skip';

function resolveBrowserLauncher(url: string): BrowserLauncher {
  if (process.platform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  }

  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'start', '', url],
    };
  }

  return {
    command: 'xdg-open',
    args: [url],
  };
}

async function openBrowser(url: string): Promise<boolean> {
  const launcher = resolveBrowserLauncher(url);

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(launcher.command, launcher.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    });

    child.once('spawn', () => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}

function resolveBrowserOpenMode(cmd: StudioCommand): BrowserOpenMode {
  if (cmd.open && cmd.noOpen) {
    throw usageError(
      'studio 옵션 충돌: --open 과 --no-open 을 동시에 사용할 수 없습니다.',
      '둘 중 하나만 지정하거나 둘 다 생략하세요.',
    );
  }

  if (cmd.open) {
    return 'open';
  }

  if (cmd.noOpen) {
    return 'skip';
  }

  // default: studio 실행 시 브라우저 자동 열기
  return 'open';
}

export async function handleStudio({ cmd, deps, globals }: StudioContext): Promise<ExitCode> {
  const browserOpenMode = resolveBrowserOpenMode(cmd);
  const session = await deps.studio.startServer({
    stateRoot: globals.stateRoot ?? undefined,
    host: cmd.host,
    port: cmd.port,
  });

  deps.io.out(`Studio started: ${session.url}`);

  if (browserOpenMode === 'open') {
    const opened = await openBrowser(session.url);
    if (opened) {
      deps.io.out('브라우저를 열었습니다.');
    } else {
      deps.io.out(`브라우저 자동 열기에 실패했습니다. 직접 접속하세요: ${session.url}`);
    }
  } else {
    deps.io.out(`브라우저 자동 열기가 비활성화되었습니다. URL: ${session.url}`);
  }

  deps.io.out('종료하려면 Ctrl+C를 누르세요.');
  void session.closed.catch(() => undefined);
  return 0;
}
