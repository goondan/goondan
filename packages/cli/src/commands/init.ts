import path from 'node:path';
import type { CliDependencies, ExitCode, InitTemplate } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type InitCommand = Extract<GdnCommand, { action: 'init' }>;

interface InitContext {
  cmd: InitCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleInit({ cmd, deps }: InitContext): Promise<ExitCode> {
  const targetDir = path.resolve(deps.cwd, cmd.initPath ?? '.');
  const dirName = path.basename(targetDir);
  const name = cmd.name ?? dirName;
  const template: InitTemplate = cmd.template;
  const asPackage = cmd.asPackage ?? false;
  const git = cmd.noGit ? false : cmd.git;
  const force = cmd.force ?? false;

  const result = await deps.init.init({
    targetDir,
    name,
    template,
    asPackage,
    git,
    force,
  });

  deps.io.out(`Initialized Goondan project at ${result.projectDir}`);
  deps.io.out(`Template: ${result.template}`);
  deps.io.out(`Files created: ${result.filesCreated.length}`);
  for (const file of result.filesCreated) {
    deps.io.out(`  ${file}`);
  }
  if (result.gitInitialized) {
    deps.io.out('Git repository initialized');
  }

  return 0;
}
