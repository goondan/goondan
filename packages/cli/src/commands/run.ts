import { usageError } from '../errors.js';
import { getBooleanOption, getStringOption } from '../options.js';
import type { RuntimeStartRequest } from '../types.js';
import { resolveBundlePath } from '../utils.js';
import type { CommandHandler } from './context.js';

export const handleRun: CommandHandler = async ({ parsed, deps, globals }) => {
  const bundleInput = parsed.subcommand ?? globals.configPath;
  const bundlePath = await resolveBundlePath(deps.cwd, bundleInput);

  if (parsed.rest.length > 0) {
    throw usageError('run 명령은 추가 위치 인자를 지원하지 않습니다.', 'gdn run [bundle-path] 형태를 사용하세요.');
  }

  const request: RuntimeStartRequest = {
    bundlePath,
    swarm: getStringOption(parsed, 'swarm'),
    instanceKey: getStringOption(parsed, 'instance-key'),
    watch: getBooleanOption(parsed, 'watch'),
    interactive: getBooleanOption(parsed, 'interactive'),
    input: getStringOption(parsed, 'input'),
    inputFile: getStringOption(parsed, 'input-file'),
    noInstall: getBooleanOption(parsed, 'no-install'),
    envFile: getStringOption(parsed, 'env-file'),
    stateRoot: globals.stateRoot,
  };

  const result = await deps.runtime.startOrchestrator(request);
  deps.io.out(`Orchestrator started (instanceKey=${result.instanceKey}${result.pid ? `, pid=${result.pid}` : ''})`);
  return 0;
};
