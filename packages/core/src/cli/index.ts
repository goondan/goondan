#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { input as promptInput } from '@inquirer/prompts';
import { object, or } from '@optique/core/constructs';
import { multiple, optional, withDefault } from '@optique/core/modifiers';
import { argument, command, constant, option } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { run as runOptique } from '@optique/run';
import { ConfigRegistry } from '../config/registry.js';
import type { Resource } from '../config/registry.js';
import { loadConfigResources } from '../config/loader.js';
import { normalizeObjectRef } from '../config/ref.js';
import { validateConfig } from '../config/validator.js';
import { Runtime, type LlmAdapter } from '../runtime/runtime.js';
import { BundleRegistry } from '../bundles/registry.js';
import { loadBundleResources, readBundleManifests } from '../bundles/loader.js';
import { installGitBundle, isGitBundleRef } from '../bundles/git.js';
import { installNpmBundle } from '../bundles/npm.js';
import type {
  BundleLockfile,
  BundleManifest,
  BundleRegistration,
  JsonObject,
  ObjectRefLike,
  ResourceMeta,
  SwarmSpec,
  Turn,
} from '../sdk/types.js';
import YAML from 'yaml';

const args = process.argv.slice(2);
const top = args[0];

if (!top || top === 'help' || top === '--help' || top === '-h') {
  printUsage();
  process.exit(0);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const parser = buildCliParser();
  const parsed = (await runOptique(parser, { programName: 'goondan', args })) as any;

  switch (parsed.action) {
    case 'init':
      await initCommand({ force: Boolean(parsed.force) });
      return;
    case 'run':
      await runCommand({
        configPaths: parsed.configPaths || [],
        bundlePaths: parsed.bundlePaths || [],
        stateRootDir: parsed.stateRootDir,
        swarmName: parsed.swarmName,
        agentName: parsed.agentName,
        input: parsed.input,
        instanceKey: parsed.instanceKey,
        mock: Boolean(parsed.mock),
        noRegistryBundles: Boolean(parsed.noRegistryBundles),
        newInstance: Boolean(parsed.newInstance),
      });
      return;
    case 'validate':
      await validateCommand({
        configPaths: parsed.configPaths || [],
        bundlePaths: parsed.bundlePaths || [],
        stateRootDir: parsed.stateRootDir,
        noRegistryBundles: Boolean(parsed.noRegistryBundles),
        strict: Boolean(parsed.strict),
      });
      return;
    case 'export':
      await exportCommand({
        configPaths: parsed.configPaths || [],
        bundlePaths: parsed.bundlePaths || [],
        output: parsed.output,
        format: parsed.format || 'yaml',
        stateRootDir: parsed.stateRootDir,
        noRegistryBundles: Boolean(parsed.noRegistryBundles),
      });
      return;
    case 'bundle:add':
    case 'bundle:remove':
    case 'bundle:enable':
    case 'bundle:disable':
    case 'bundle:info':
    case 'bundle:validate':
    case 'bundle:verify':
    case 'bundle:lock':
    case 'bundle:verify-lock':
    case 'bundle:refresh':
    case 'bundle:list':
      await bundleCommand(parsed);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

type RunOptions = {
  configPaths: string[];
  bundlePaths: string[];
  stateRootDir?: string;
  swarmName?: string;
  agentName?: string;
  input?: string;
  instanceKey?: string;
  mock?: boolean;
  noRegistryBundles?: boolean;
  newInstance?: boolean;
};

async function runCommand(options: RunOptions): Promise<void> {
  if (options.configPaths.length === 0) {
    const defaultPath = path.join(process.cwd(), 'goondan.yaml');
    const exists = await fs.stat(defaultPath).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('--config 또는 -c 옵션으로 config 파일을 지정해야 합니다.');
    }
    options.configPaths = [defaultPath];
  }

  const stateRootDir = options.stateRootDir || path.join(process.cwd(), 'state');
  const bundleRegistry = new BundleRegistry({ rootDir: stateRootDir, logger: console });
  await bundleRegistry.load();
  const bundlePaths = options.noRegistryBundles ? options.bundlePaths : [...bundleRegistry.resolveEnabledPaths(), ...options.bundlePaths];

  const bundleResources =
    bundlePaths.length > 0 ? await loadBundleResources(bundlePaths, { baseDir: process.cwd(), stateRootDir }) : [];
  const configResources = await loadConfigResources(options.configPaths, { baseDir: process.cwd() });
  const registry = new ConfigRegistry([...bundleResources, ...configResources], { baseDir: process.cwd() });

  const validation = validateConfig(registry.list(), { registry });
  if (!validation.valid) {
    const message = validation.errors.map((err) => `${err.resource}: ${err.path ?? ''} ${err.message}`).join('\n');
    throw new Error(`Config 검증 실패:\n${message}`);
  }

  const runtime = new Runtime({
    registry,
    stateRootDir,
    llm: options.mock ? createMockLlmAdapter() : undefined,
    validateOnInit: false,
  });
  runtime.registerConnectorAdapter('cli', createCliConnectorAdapter);
  await runtime.init();

  const swarmResource = resolveSwarmResource(registry, options.swarmName);
  const swarmRef = { kind: 'Swarm', name: swarmResource.metadata.name };
  const instanceKey = options.instanceKey || (options.newInstance ? `cli-${Date.now()}` : 'cli');

  const entryAgent = resolveEntrypointAgent(swarmResource);
  const agentName = options.agentName || entryAgent;
  if (!agentName) {
    throw new Error('agentName 또는 Swarm.entrypoint가 필요합니다.');
  }

  const cliConnector = registry.get('Connector', 'cli');
  const dispatchInput = async (text: string) => {
    if (cliConnector) {
      await runtime.handleConnectorEvent('cli', {
        text,
        instanceKey,
        swarmRef,
        agentName,
      } as JsonObject);
      return;
    }

    const swarmInstance = await runtime.getOrCreateSwarmInstance(swarmRef, instanceKey);
    const agent = swarmInstance.getAgent(agentName);
    if (!agent) {
      throw new Error(`AgentInstance를 찾을 수 없습니다: ${agentName}`);
    }

    const turn = await agent.runTurn({
      input: text,
      origin: { connector: 'cli' },
      auth: {},
      metadata: { source: 'cli' },
    });
    printTurnResult(turn);
  };

  if (options.input) {
    await dispatchInput(options.input);
    return;
  }

  if (!process.stdin.isTTY) {
    const stdinInput = await readStdin();
    if (!stdinInput) {
      throw new Error('입력 텍스트가 비어 있습니다. --input 또는 stdin을 사용하세요.');
    }
    await dispatchInput(stdinInput);
    return;
  }

  await startInteractiveSession(dispatchInput);
}

const DEFAULT_BASE_SPEC = 'github.com/goondan/goondan/packages/base';

async function initCommand(options: { force: boolean }): Promise<void> {
  const force = options.force;
  const target = path.join(process.cwd(), 'goondan.yaml');
  const exists = await fs.stat(target).then(() => true).catch(() => false);
  if (exists && !force) {
    throw new Error('goondan.yaml이 이미 존재합니다. 덮어쓰려면 --force를 사용하세요.');
  }

  const content = buildInitTemplate();
  await fs.writeFile(target, content, 'utf8');
  console.log(`goondan.yaml 생성 완료: ${target}`);
  try {
    const stateRootDir = path.join(process.cwd(), 'state');
    const registry = new BundleRegistry({ rootDir: stateRootDir, logger: console });
    const installed = await installBundleSpec(DEFAULT_BASE_SPEC, { stateRootDir });
    await registry.add(installed.manifestPath, 'base', installed.metadata);
    console.log(`base 번들 등록 완료: ${installed.label}`);
  } catch (err) {
    throw new Error(`base 번들 등록 실패: ${(err as Error).message}`);
  }
}

async function bundleCommand(parsed: any): Promise<void> {
  const stateRootDir = parsed.stateRootDir || path.join(process.cwd(), 'state');
  const registry = new BundleRegistry({ rootDir: stateRootDir, logger: console });

  switch (parsed.action) {
    case 'bundle:add': {
      const resolved = await resolveBundleAddTarget(parsed.path, parsed.stateRootDir || path.join(process.cwd(), 'state'));
      const nameOverride = parsed.name || resolved.name;
      const entry = await registry.add(resolved.manifestPath, nameOverride || undefined, resolved.metadata);
      console.log(`Bundle 등록 완료: ${entry.name} -> ${entry.path}`);
      return;
    }
    case 'bundle:remove': {
      const removed = await registry.remove(parsed.name);
      if (!removed) {
        console.log(`Bundle 없음: ${parsed.name}`);
      } else {
        console.log(`Bundle 제거 완료: ${parsed.name}`);
      }
      return;
    }
    case 'bundle:list': {
      await registry.load();
      const entries = registry.list();
      if (entries.length === 0) {
        console.log('등록된 Bundle이 없습니다.');
        return;
      }
      for (const entry of entries) {
        const state = entry.enabled === false ? 'disabled' : 'enabled';
        console.log(`${entry.name}\t${state}\t${entry.path}`);
      }
      return;
    }
    case 'bundle:enable': {
      const ok = await registry.enable(parsed.name);
      if (!ok) {
        console.log(`Bundle 없음: ${parsed.name}`);
      } else {
        console.log(`Bundle 활성화: ${parsed.name}`);
      }
      return;
    }
    case 'bundle:disable': {
      const ok = await registry.disable(parsed.name);
      if (!ok) {
        console.log(`Bundle 없음: ${parsed.name}`);
      } else {
        console.log(`Bundle 비활성화: ${parsed.name}`);
      }
      return;
    }
    case 'bundle:info': {
      const resolved = await resolveBundleTarget(parsed.target, registry);
      const manifest = await readBundleManifest(resolved.path);
      const hash = await computeFileHash(resolved.path);
      const resources = await loadBundleResources(resolved.path, { baseDir: process.cwd(), stateRootDir });
      printBundleInfo(manifest, resolved.path, hash, resolved.entry?.fingerprint || null, resources);
      return;
    }
    case 'bundle:validate': {
      const strict = Boolean(parsed.strict);
      const resolved = await resolveBundleTarget(parsed.target, registry);
      const manifestPath = resolved.path;
      const resources = await loadBundleResources(manifestPath, { baseDir: process.cwd(), stateRootDir });
      const validation = strict
        ? validateConfig(resources, { registry: new ConfigRegistry(resources, { baseDir: process.cwd() }) })
        : validateConfig(resources);
      if (!validation.valid) {
        const message = validation.errors.map((err) => `${err.resource}: ${err.path ?? ''} ${err.message}`).join('\n');
        throw new Error(`Bundle 검증 실패:\n${message}`);
      }
      if (strict) {
        const integrity = await validateResourceIntegrity(resources, process.cwd());
        if (integrity.errors.length > 0) {
          throw new Error(`Bundle 검증 실패:\n${integrity.errors.join('\n')}`);
        }
      }
      console.log('Bundle 검증 성공');
      return;
    }
    case 'bundle:verify': {
      const resolved = await resolveBundleTarget(parsed.target, registry);
      const hash = await computeFileHash(resolved.path);
      if (!hash) throw new Error('Bundle 해시를 계산할 수 없습니다.');
      if (!resolved.entry?.fingerprint) {
        console.log(`SHA256: ${hash}`);
        console.log('등록된 fingerprint가 없습니다. bundle add 또는 bundle refresh가 필요합니다.');
        return;
      }
      if (hash !== resolved.entry.fingerprint) {
        throw new Error(`Bundle fingerprint 불일치: stored=${resolved.entry.fingerprint} actual=${hash}`);
      }
      console.log(`Bundle fingerprint 일치: ${hash}`);
      return;
    }
    case 'bundle:lock': {
      const includeDisabled = Boolean(parsed.includeDisabled);
      await registry.load();
      const entries = registry.list().filter((entry) => includeDisabled || entry.enabled !== false);
      const output = parsed.output || path.join(stateRootDir, 'bundles.lock.json');
      const lockfile = await buildBundleLockfile(entries);
      const outPath = path.isAbsolute(output) ? output : path.join(process.cwd(), output);
      await fs.writeFile(outPath, JSON.stringify(lockfile, null, 2), 'utf8');
      console.log(`Bundle lockfile 생성: ${outPath}`);
      return;
    }
    case 'bundle:verify-lock': {
      const lockPath = parsed.lock || path.join(stateRootDir, 'bundles.lock.json');
      const resolved = path.isAbsolute(lockPath) ? lockPath : path.join(process.cwd(), lockPath);
      const lockfile = await readBundleLockfile(resolved);
      const errors = await verifyBundleLockfile(lockfile);
      if (errors.length > 0) {
        throw new Error(`Bundle lock 검증 실패:\n${errors.join('\n')}`);
      }
      console.log('Bundle lock 검증 성공');
      return;
    }
    case 'bundle:refresh': {
      const entry = await registry.refresh(parsed.name);
      if (!entry) {
        console.log(`Bundle 없음: ${parsed.name}`);
        return;
      }
      console.log(`Bundle fingerprint 갱신: ${entry.fingerprint || 'unknown'}`);
      return;
    }
    default:
      printBundleUsage();
      process.exitCode = 1;
  }
}

type ValidateOptions = {
  configPaths: string[];
  bundlePaths: string[];
  stateRootDir?: string;
  noRegistryBundles?: boolean;
  strict?: boolean;
};

async function validateCommand(options: ValidateOptions): Promise<void> {
  if (options.configPaths.length === 0) {
    throw new Error('--config 또는 -c 옵션으로 config 파일을 지정해야 합니다.');
  }
  const strict = Boolean(options.strict);
  const stateRootDir = options.stateRootDir || path.join(process.cwd(), 'state');
  const bundleResources =
    options.bundlePaths.length > 0 ? await loadBundleResources(options.bundlePaths, { baseDir: process.cwd(), stateRootDir }) : [];
  const configResources = await loadConfigResources(options.configPaths, { baseDir: process.cwd() });
  const resources = [...bundleResources, ...configResources];
  const registry = new ConfigRegistry(resources, { baseDir: process.cwd() });
  const validation = validateConfig(registry.list(), { registry });
  if (!validation.valid) {
    const message = validation.errors.map((err) => `${err.resource}: ${err.path ?? ''} ${err.message}`).join('\n');
    throw new Error(`Config 검증 실패:\n${message}`);
  }
  if (strict) {
    const integrity = await validateResourceIntegrity(resources, process.cwd());
    if (integrity.errors.length > 0) {
      throw new Error(`Config 검증 실패:\n${integrity.errors.join('\n')}`);
    }
  }
  console.log('Config 검증 성공');
}

type ExportOptions = {
  configPaths: string[];
  bundlePaths: string[];
  output?: string;
  format?: string;
  stateRootDir?: string;
  noRegistryBundles?: boolean;
};

async function exportCommand(options: ExportOptions): Promise<void> {
  if (options.configPaths.length === 0) {
    throw new Error('--config 또는 -c 옵션으로 config 파일을 지정해야 합니다.');
  }

  const stateRootDir = options.stateRootDir || path.join(process.cwd(), 'state');
  const bundleRegistry = new BundleRegistry({ rootDir: stateRootDir, logger: console });
  await bundleRegistry.load();
  const bundlePaths = options.noRegistryBundles ? options.bundlePaths : [...bundleRegistry.resolveEnabledPaths(), ...options.bundlePaths];

  const bundleResources =
    bundlePaths.length > 0 ? await loadBundleResources(bundlePaths, { baseDir: process.cwd(), stateRootDir }) : [];
  const configResources = await loadConfigResources(options.configPaths, { baseDir: process.cwd() });
  const resources = [...bundleResources, ...configResources];
  const sorted = resources.slice().sort((a, b) => {
    const ak = `${a.kind}/${a.metadata?.name || ''}`;
    const bk = `${b.kind}/${b.metadata?.name || ''}`;
    return ak.localeCompare(bk);
  });

  const format = options.format === 'json' ? 'json' : 'yaml';
  const output = renderResources(sorted, format);
  if (options.output) {
    const outPath = path.isAbsolute(options.output) ? options.output : path.join(process.cwd(), options.output);
    await fs.writeFile(outPath, output, 'utf8');
    console.log(`export 완료: ${outPath}`);
    return;
  }
  console.log(output);
}

function resolveSwarmResource(registry: ConfigRegistry, swarmName?: string): Resource {
  if (swarmName) {
    const resource = registry.get('Swarm', swarmName);
    if (!resource) throw new Error(`Swarm을 찾을 수 없습니다: ${swarmName}`);
    return resource;
  }
  const swarms = registry.list('Swarm');
  if (swarms.length === 1) {
    return swarms[0] as Resource;
  }
  if (swarms.length === 0) {
    throw new Error('Swarm 리소스를 찾을 수 없습니다.');
  }
  throw new Error(`Swarm이 여러 개입니다. --swarm으로 지정하세요: ${swarms.map((s) => s.metadata.name).join(', ')}`);
}

function resolveEntrypointAgent(swarmResource: Resource): string | undefined {
  const spec = swarmResource.spec as SwarmSpec | undefined;
  const entry = spec?.entrypoint;
  if (!entry) return undefined;
  const ref = normalizeObjectRef(entry as ObjectRefLike, 'Agent');
  return ref?.name || undefined;
}

function printTurnResult(turn: Turn) {
  if (turn.summary) {
    console.log(turn.summary);
    return;
  }
  const output = {
    id: turn.id,
    toolResults: turn.toolResults,
    metadata: turn.metadata,
  };
  console.log(JSON.stringify(output, null, 2));
}

function createMockLlmAdapter(): LlmAdapter {
  return async (input) => {
    const text = input.turn?.input || '';
    return {
      content: text ? `mock:${text}` : 'mock:ok',
      toolCalls: [],
      meta: { provider: 'mock', usage: { totalTokens: 0 } } as JsonObject,
    };
  };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function printUsage(): void {
  console.log(`\nGoondan CLI\n\n사용법:\n  goondan init [--force]\n  goondan run -c <config.yaml> [options]\n  goondan validate -c <config.yaml> [--strict]\n  goondan export -c <config.yaml> [options]\n  goondan bundle <add|remove|enable|disable|info|validate|verify|lock|verify-lock|refresh|list> [args]\n\n옵션 (init):\n  --force, -f                기존 goondan.yaml 덮어쓰기\n\n옵션 (run):\n  -c, --config <path>         Config YAML 경로 (복수 가능)\n  -b, --bundle <path>         Bundle manifest 경로 (복수 가능)\n  --state-root <dir>          상태 루트 디렉터리 (bundles.json 저장 위치)\n  --swarm <name>              실행할 Swarm 이름\n  --agent <name>              실행할 Agent 이름 (미지정 시 entrypoint)\n  --instance-key <key>        인스턴스 키 (기본: cli)\n  --input <text>              입력 텍스트 (미지정 시 stdin)\n  --mock                       mock LLM 사용\n  --no-registry-bundles        등록된 Bundle 로드를 비활성화\n  --new, -n                  새 SwarmInstance 실행\n\n옵션 (validate):\n  --strict                    entry 존재/중복 리소스 체크\n\n옵션 (export):\n  -c, --config <path>         Config YAML 경로 (복수 가능)\n  -b, --bundle <path>         Bundle manifest 경로 (복수 가능)\n  -o, --output <path>         출력 파일 경로 (미지정 시 stdout)\n  --format <yaml|json>        출력 포맷 (기본: yaml)\n  --state-root <dir>          상태 루트 디렉터리 (bundles.json 저장 위치)\n  --no-registry-bundles        등록된 Bundle 로드를 비활성화\n\n옵션 (bundle):\n  add <path> [--name <name>]  Bundle 등록\n  remove <name>               Bundle 제거\n  enable <name>               Bundle 활성화\n  disable <name>              Bundle 비활성화\n  info <name|path>            Bundle 정보 출력\n  validate <name|path>        Bundle 검증 (--strict 사용 가능)\n  verify <name|path>          Bundle fingerprint 검증\n  lock                        Bundle lockfile 생성 (--output/--all)\n  verify-lock                 Bundle lockfile 검증 (--lock)\n  refresh <name>              Bundle fingerprint 갱신\n  list                        Bundle 목록\n`);
}

function printBundleUsage(): void {
  console.log(`\n사용법:\n  goondan bundle add <path> [--name <name>]\n  goondan bundle remove <name>\n  goondan bundle enable <name>\n  goondan bundle disable <name>\n  goondan bundle info <name|path>\n  goondan bundle validate <name|path> [--strict]\n  goondan bundle verify <name|path>\n  goondan bundle lock [--output <path>] [--all]\n  goondan bundle verify-lock [--lock <path>]\n  goondan bundle refresh <name>\n  goondan bundle list\n`);
}

function buildInitTemplate(): string {
  return `# Goondan init template
# - base 번들은 Git 번들로 등록됩니다.

apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

# ---
# apiVersion: agents.example.io/v1alpha1
# kind: Model
# metadata:
#   name: openai-gpt-5-2
# spec:
#   provider: openai
#   name: gpt-5.2

# ---
# apiVersion: agents.example.io/v1alpha1
# kind: Model
# metadata:
#   name: google-gemini-2-5-flash
# spec:
#   provider: google
#   name: gemini-2.5-flash

---
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: Model/default-model
  prompts:
    system: |
      너는 Goondan default 에이전트다.
      사용자의 요청을 수행하기 위해 필요한 경우 도구를 호출한다.
  tools:
    - { kind: Tool, name: fileRead }
  extensions:
    - { kind: Extension, name: compaction }

---
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }

---
apiVersion: agents.example.io/v1alpha1
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: \"$.instanceKey\"
        inputFrom: \"$.text\"
`;
}

async function resolveBundleTarget(
  target: string,
  registry: BundleRegistry
): Promise<{ path: string; entry: BundleRegistration | null }> {
  const resolved = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isFile()) return { path: resolved, entry: null };

  await registry.load();
  const entry = registry.get(target);
  if (!entry) {
    throw new Error(`Bundle을 찾을 수 없습니다: ${target}`);
  }
  return { path: entry.path, entry };
}

async function installBundleSpec(
  spec: string,
  options: { stateRootDir: string }
): Promise<{ manifestPath: string; metadata?: Partial<BundleRegistration>; label: string }> {
  if (isGitBundleRef(spec)) {
    const installed = await installGitBundle(spec, { stateRootDir: options.stateRootDir });
    const pathPart = installed.ref.path ? `/${installed.ref.path}` : '';
    const refPart = installed.ref.ref ? `@${installed.ref.ref}` : '';
    const label = `${installed.ref.host}/${installed.ref.org}/${installed.ref.repo}${pathPart}${refPart}`;
    return {
      manifestPath: installed.manifestPath,
      metadata: {
        source: {
          type: 'git',
          host: installed.ref.host,
          org: installed.ref.org,
          repo: installed.ref.repo,
          path: installed.ref.path,
          ref: installed.ref.ref,
          url: installed.ref.url,
          commit: installed.commit,
          spec,
        },
      },
      label,
    };
  }

  if (spec.startsWith('npm:') || spec.startsWith('@')) {
    const installed = await installNpmBundle(spec, { stateRootDir: options.stateRootDir });
    return {
      manifestPath: installed.manifestPath,
      metadata: {
        source: {
          type: 'npm',
          name: installed.name,
          version: installed.version,
          registry: installed.registry,
          spec,
        },
      },
      label: `${installed.name}@${installed.version}`,
    };
  }

  const resolved = path.isAbsolute(spec) ? spec : path.join(process.cwd(), spec);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isFile() || stat?.isDirectory()) {
    return { manifestPath: resolved, label: resolved };
  }

  throw new Error(`지원하지 않는 Bundle spec입니다: ${spec}`);
}

async function resolveBundleAddTarget(
  input: string,
  stateRootDir: string
): Promise<{ manifestPath: string; name?: string; metadata?: Partial<BundleRegistration> }> {
  const resolved = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isFile() || stat?.isDirectory()) {
    return { manifestPath: resolved };
  }

  if (isGitBundleRef(input)) {
    const installed = await installGitBundle(input, { stateRootDir });
    return {
      manifestPath: installed.manifestPath,
      metadata: {
        source: {
          type: 'git',
          host: installed.ref.host,
          org: installed.ref.org,
          repo: installed.ref.repo,
          path: installed.ref.path,
          ref: installed.ref.ref,
          url: installed.ref.url,
          commit: installed.commit,
          spec: input,
        },
      },
    };
  }

  if (input.startsWith('npm:') || input.startsWith('@')) {
    const installed = await installNpmBundle(input, { stateRootDir });
    return {
      manifestPath: installed.manifestPath,
      name: installed.name,
      metadata: {
        source: {
          type: 'npm',
          name: installed.name,
          version: installed.version,
          registry: installed.registry,
          spec: input,
        },
      },
    };
  }

  throw new Error(`지원하지 않는 Bundle 경로입니다: ${input}`);
}

async function readBundleManifest(manifestPath: string): Promise<BundleManifest> {
  const manifests = await readBundleManifests(manifestPath, { baseDir: process.cwd() });
  if (manifests.length === 0) {
    throw new Error(`Bundle manifest가 비어 있습니다: ${manifestPath}`);
  }
  if (manifests.length > 1) {
    throw new Error(`Bundle manifest가 여러 개입니다. 하나의 Bundle만 포함해야 합니다: ${manifestPath}`);
  }
  return manifests[0]?.manifest as BundleManifest;
}

function printBundleInfo(
  manifest: BundleManifest,
  manifestPath: string,
  hash: string | null,
  stored: string | null,
  resources: Array<{ kind?: string; metadata?: ResourceMeta }> = []
): void {
  const kinds = summarizeKinds(resources.map((resource) => resource.kind));
  const dependencies = manifest.spec?.dependencies || [];
  const include = manifest.spec?.include || [];
  console.log(`Bundle: ${manifest.metadata?.name || 'unknown'}`);
  console.log(`Path: ${manifestPath}`);
  if (hash) {
    console.log(`SHA256: ${hash}`);
  }
  if (stored && hash && stored !== hash) {
    console.log(`Stored: ${stored} (stale)`);
  } else if (stored) {
    console.log(`Stored: ${stored}`);
  }
  if (manifest.spec?.version) {
    console.log(`Version: ${manifest.spec.version}`);
  }
  if (dependencies.length > 0) {
    console.log('Dependencies:');
    for (const dep of dependencies) {
      console.log(`  - ${dep}`);
    }
  }
  if (include.length > 0) {
    console.log('Include:');
    for (const item of include) {
      console.log(`  - ${item}`);
    }
  }
  if (Object.keys(kinds).length > 0) {
    console.log('Kinds:');
    for (const [kind, count] of Object.entries(kinds)) {
      console.log(`  - ${kind}: ${count}`);
    }
  }
  if (resources.length > 0) {
    console.log('Resources:');
    for (const resource of resources) {
      const meta = resource.metadata as ResourceMeta | undefined;
      const name = meta?.name || 'unknown';
      console.log(`  - ${resource.kind}/${name}`);
    }
  }
}

async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

async function validateResourceIntegrity(
  resources: Array<{ kind: string; metadata?: ResourceMeta; spec?: unknown }>,
  baseDir: string
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    const name = resource.metadata?.name || 'unknown';
    const key = `${resource.kind}/${name}`;
    if (seen.has(key)) {
      errors.push(`중복 리소스: ${key}`);
    } else {
      seen.add(key);
    }
  }

  for (const resource of resources) {
    if (!resource.spec || typeof resource.spec !== 'object') continue;
    const entryValue = (resource.spec as { entry?: string }).entry;
    if (typeof entryValue !== 'string' || entryValue.length === 0) continue;
    const entryPath = path.isAbsolute(entryValue) ? entryValue : path.join(baseDir, entryValue);
    const name = resource.metadata?.name || 'unknown';
    try {
      await fs.stat(entryPath);
    } catch {
      errors.push(`entry 경로를 찾을 수 없습니다: ${resource.kind}/${name} -> ${entryPath}`);
    }
  }

  return { errors };
}

function summarizeKinds(kinds: Array<string | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of kinds) {
    if (!kind) continue;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function renderResources(resources: Array<unknown>, format: 'yaml' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(resources, null, 2);
  }
  const docs = resources.map((resource) => YAML.stringify(resource).trim()).filter(Boolean);
  return `${docs.join('\n---\n')}\n`;
}

function buildCliParser() {
  const initParser = command(
    'init',
    object({
      action: constant('init'),
      force: optional(option('-f', '--force')),
    })
  );

  const runParser = command(
    'run',
    object({
      action: constant('run'),
      configPaths: withDefault(multiple(option('-c', '--config', string())), []),
      bundlePaths: withDefault(multiple(option('-b', '--bundle', string())), []),
      stateRootDir: optional(option('--state-root', string())),
      swarmName: optional(option('--swarm', string())),
      agentName: optional(option('--agent', string())),
      input: optional(option('--input', string())),
      instanceKey: optional(option('--instance-key', string())),
      mock: optional(option('--mock')),
      noRegistryBundles: optional(option('--no-registry-bundles')),
      newInstance: optional(option('-n', '--new')),
    })
  );

  const validateParser = command(
    'validate',
    object({
      action: constant('validate'),
      configPaths: withDefault(multiple(option('-c', '--config', string())), []),
      bundlePaths: withDefault(multiple(option('-b', '--bundle', string())), []),
      stateRootDir: optional(option('--state-root', string())),
      noRegistryBundles: optional(option('--no-registry-bundles')),
      strict: optional(option('--strict')),
    })
  );

  const exportParser = command(
    'export',
    object({
      action: constant('export'),
      configPaths: withDefault(multiple(option('-c', '--config', string())), []),
      bundlePaths: withDefault(multiple(option('-b', '--bundle', string())), []),
      output: optional(option('-o', '--output', string())),
      format: withDefault(option('--format', string()), 'yaml'),
      stateRootDir: optional(option('--state-root', string())),
      noRegistryBundles: optional(option('--no-registry-bundles')),
    })
  );

  const bundleParser = command(
    'bundle',
    or(
      command(
        'add',
        object({
          action: constant('bundle:add'),
          path: argument(string()),
          name: optional(option('--name', string())),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'remove',
        object({
          action: constant('bundle:remove'),
          name: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'enable',
        object({
          action: constant('bundle:enable'),
          name: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'disable',
        object({
          action: constant('bundle:disable'),
          name: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'info',
        object({
          action: constant('bundle:info'),
          target: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'validate',
        object({
          action: constant('bundle:validate'),
          target: argument(string()),
          strict: optional(option('--strict')),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'verify',
        object({
          action: constant('bundle:verify'),
          target: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'lock',
        object({
          action: constant('bundle:lock'),
          output: optional(option('--output', string())),
          includeDisabled: optional(option('--all', '--include-disabled')),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'verify-lock',
        object({
          action: constant('bundle:verify-lock'),
          lock: optional(option('--lock', string())),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'refresh',
        object({
          action: constant('bundle:refresh'),
          name: argument(string()),
          stateRootDir: optional(option('--state-root', string())),
        })
      ),
      command(
        'list',
        object({
          action: constant('bundle:list'),
          stateRootDir: optional(option('--state-root', string())),
        })
      )
    )
  );

  return or(initParser, runParser, validateParser, exportParser, bundleParser);
}

async function startInteractiveSession(dispatch: (input: string) => Promise<void>): Promise<void> {
  while (true) {
    let line = '';
    try {
      line = await promptInput({ message: '> ' }, { clearPromptOnDone: false });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'AbortPromptError') return;
      throw err;
    }
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    if (trimmed === ':exit' || trimmed === ':quit') return;
    try {
      await dispatch(trimmed);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  }
}

function createCliConnectorAdapter(options: { runtime: Runtime; connectorConfig: { spec?: unknown; metadata?: { name?: string } }; logger?: Console }) {
  const logger = options.logger || console;
  const config = options.connectorConfig as {
    metadata?: { name?: string };
    spec?: { ingress?: Array<JsonObject> };
  };

  async function handleEvent(payload: JsonObject): Promise<void> {
    const ingressRules = config.spec?.ingress || [];
    const text = String(payload.text || '');

    if (ingressRules.length === 0) {
      const swarmRef = payload.swarmRef as ObjectRefLike | undefined;
      const instanceKey = String(payload.instanceKey || 'cli');
      if (!swarmRef) {
        logger.warn('cli connector: swarmRef가 없습니다.');
        return;
      }
      await options.runtime.handleEvent({
        swarmRef,
        instanceKey,
        agentName: payload.agentName as string | undefined,
        input: text,
        origin: { connector: config.metadata?.name || 'cli' },
        auth: {},
        metadata: { connector: config.metadata?.name || 'cli' },
      });
      return;
    }

    for (const rule of ingressRules) {
      const match = rule.match as { command?: string } | undefined;
      if (match?.command && !text.startsWith(match.command)) {
        continue;
      }

      const route = rule.route as {
        swarmRef?: ObjectRefLike;
        instanceKeyFrom?: string;
        inputFrom?: string;
        agentName?: string;
      };

      if (!route?.swarmRef) {
        logger.warn('cli ingress rule에 swarmRef가 없습니다.');
        continue;
      }

      const instanceKey = String(readPath(payload, route.instanceKeyFrom || '$.instanceKey') || 'cli');
      const input = String(readPath(payload, route.inputFrom || '$.text') || text);
      await options.runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey,
        agentName: route.agentName,
        input,
        origin: { connector: config.metadata?.name || 'cli' },
        auth: {},
        metadata: { connector: config.metadata?.name || 'cli' },
      });
      return;
    }
  }

  async function send(input: { text: string }): Promise<{ ok: true }> {
    if (input?.text) {
      console.log(input.text);
    }
    return { ok: true };
  }

  return { handleEvent, send };
}

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr) return undefined;
  if (!expr.startsWith('$.')) return undefined;
  const pathParts = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of pathParts) {
    if (current == null) return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}

async function buildBundleLockfile(entries: BundleRegistration[]): Promise<BundleLockfile> {
  const bundles: BundleLockfile['bundles'] = [];
  for (const entry of entries) {
    const fingerprint = (await computeFileHash(entry.path)) || entry.fingerprint || 'unknown';
    bundles.push({
      name: entry.name,
      path: entry.path,
      fingerprint,
      enabled: entry.enabled,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    bundles,
  };
}

async function readBundleLockfile(lockPath: string): Promise<BundleLockfile> {
  const content = await fs.readFile(lockPath, 'utf8');
  const parsed = JSON.parse(content) as BundleLockfile;
  if (!parsed?.bundles) {
    throw new Error(`유효하지 않은 lockfile: ${lockPath}`);
  }
  return parsed;
}

async function verifyBundleLockfile(lockfile: BundleLockfile): Promise<string[]> {
  const errors: string[] = [];
  for (const bundle of lockfile.bundles || []) {
    const actual = await computeFileHash(bundle.path);
    if (!actual) {
      errors.push(`bundle 파일을 찾을 수 없습니다: ${bundle.name} -> ${bundle.path}`);
      continue;
    }
    if (actual !== bundle.fingerprint) {
      errors.push(`bundle fingerprint 불일치: ${bundle.name} stored=${bundle.fingerprint} actual=${actual}`);
    }
  }
  return errors;
}
