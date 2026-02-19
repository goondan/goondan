import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type PackageAddCommand = Extract<GdnCommand, { action: 'package.add' }>;
type PackageInstallCommand = Extract<GdnCommand, { action: 'package.install' }>;
type PackageUpdateCommand = Extract<GdnCommand, { action: 'package.update' }>;
type PackagePublishCommand = Extract<GdnCommand, { action: 'package.publish' }>;

interface PackageAddContext {
  cmd: PackageAddCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface PackageInstallContext {
  cmd: PackageInstallCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface PackagePublishContext {
  cmd: PackagePublishCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface PackageUpdateContext {
  cmd: PackageUpdateCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handlePackageAdd({ cmd, deps, globals }: PackageAddContext): Promise<ExitCode> {
  const bundlePath = globals.config;
  const registry = cmd.registry ?? undefined;

  const result = await deps.packages.addDependency({
    ref: cmd.ref,
    dev: cmd.dev ?? false,
    exact: cmd.exact ?? false,
    registry,
    bundlePath,
    stateRoot: globals.stateRoot ?? undefined,
  });

  const installResult = await deps.packages.installDependencies({
    frozenLockfile: false,
    bundlePath,
    registry,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(
    `Dependency ${result.added ? 'added' : 'already exists'}: ${result.ref}` +
      `${result.resolvedVersion ? ` (${result.resolvedVersion})` : ''}`,
  );
  deps.io.out(`Manifest: ${result.manifestPath}`);
  deps.io.out(`Installed dependencies: ${installResult.installed}`);
  return 0;
}

export async function handlePackageInstall({ cmd, deps, globals }: PackageInstallContext): Promise<ExitCode> {
  const result = await deps.packages.installDependencies({
    frozenLockfile: cmd.frozenLockfile ?? false,
    bundlePath: globals.config,
    registry: cmd.registry ?? undefined,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(`Installed dependencies: ${result.installed}`);
  if (result.lockfilePath) {
    deps.io.out(`Lockfile: ${result.lockfilePath}`);
  }
  return 0;
}

export async function handlePackageUpdate({ cmd, deps, globals }: PackageUpdateContext): Promise<ExitCode> {
  const bundlePath = globals.config;
  const registry = cmd.registry ?? undefined;

  const updateResult = await deps.packages.updateDependencies({
    exact: cmd.exact ?? false,
    bundlePath,
    registry,
    stateRoot: globals.stateRoot ?? undefined,
  });

  const installResult = await deps.packages.installDependencies({
    frozenLockfile: false,
    bundlePath,
    registry,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(`Updated dependencies: ${updateResult.updated}/${updateResult.total}`);
  deps.io.out(`Manifest: ${updateResult.manifestPath}`);
  for (const change of updateResult.changes) {
    deps.io.out(
      `- ${change.name}: ${change.previousVersion} -> ${change.nextVersion} (resolved ${change.resolvedVersion})`,
    );
  }

  if (updateResult.skipped.length > 0) {
    deps.io.out(`Skipped dependencies: ${updateResult.skipped.length}`);
    for (const skipped of updateResult.skipped) {
      deps.io.out(`- ${skipped.name}@${skipped.version}: ${skipped.reason}`);
    }
  }

  deps.io.out(`Installed dependencies: ${installResult.installed}`);
  if (installResult.lockfilePath) {
    deps.io.out(`Lockfile: ${installResult.lockfilePath}`);
  }

  return 0;
}

export async function handlePackagePublish({ cmd, deps, globals }: PackagePublishContext): Promise<ExitCode> {
  const publishPath = cmd.publishPath ?? '.';

  const result = await deps.packages.publishPackage({
    path: publishPath,
    tag: cmd.tag,
    access: cmd.access,
    dryRun: cmd.dryRun ?? false,
    registry: cmd.registry ?? undefined,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(
    `${result.dryRun ? 'Dry-run publish checked' : 'Published'} ${result.packageName}@${result.version}` +
      ` tag=${result.tag} registry=${result.registryUrl}`,
  );
  return 0;
}
