import path from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configError } from '../errors.js';
import type { InitRequest, InitResult, InitService, InitTemplate } from '../types.js';
import { exists } from '../utils.js';

const execFileAsync = promisify(execFile);

function quoteYaml(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

interface TemplateFiles {
  [relativePath: string]: string;
}

function buildModelYaml(): string {
  return [
    'apiVersion: goondan.ai/v1',
    'kind: Model',
    'metadata:',
    '  name: claude',
    'spec:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-20250514',
    '  apiKey:',
    '    valueFrom:',
    '      env: ANTHROPIC_API_KEY',
  ].join('\n');
}

function buildAgentYaml(agentName: string, modelRef: string, systemPrompt: string): string {
  return [
    'apiVersion: goondan.ai/v1',
    'kind: Agent',
    'metadata:',
    `  name: ${agentName}`,
    'spec:',
    '  modelConfig:',
    `    modelRef: ${quoteYaml(modelRef)}`,
    '  prompts:',
    '    systemPrompt: |',
    `      ${systemPrompt}`,
  ].join('\n');
}

function buildSwarmYaml(agents: string[], entryAgent: string): string {
  const agentRefs = agents.map((a) => `    - ref: ${quoteYaml(`Agent/${a}`)}`).join('\n');
  return [
    'apiVersion: goondan.ai/v1',
    'kind: Swarm',
    'metadata:',
    '  name: default',
    'spec:',
    `  entryAgent: ${quoteYaml(`Agent/${entryAgent}`)}`,
    '  agents:',
    agentRefs,
  ].join('\n');
}

function buildPackageYaml(name: string): string {
  return [
    'apiVersion: goondan.ai/v1',
    'kind: Package',
    'metadata:',
    `  name: ${quoteYaml(name)}`,
    'spec:',
    '  version: "0.1.0"',
  ].join('\n');
}

function defaultTemplate(name: string): TemplateFiles {
  const model = buildModelYaml();
  const agent = buildAgentYaml('assistant', 'Model/claude', 'You are a helpful assistant.');
  const swarm = buildSwarmYaml(['assistant'], 'assistant');

  const docs: string[] = [buildPackageYaml(name), model, agent, swarm];

  return {
    'goondan.yaml': docs.join('\n---\n') + '\n',
    'prompts/default.system.md': 'You are a helpful assistant.\n',
    '.env': '# ANTHROPIC_API_KEY=sk-ant-...\n',
    '.gitignore': 'node_modules/\n.env.local\n',
  };
}

function multiAgentTemplate(name: string): TemplateFiles {
  const model = buildModelYaml();
  const planner = buildAgentYaml('planner', 'Model/claude', 'You are a planning agent. Break tasks into steps.');
  const coder = buildAgentYaml('coder', 'Model/claude', 'You are a coding agent. Implement the plan.');
  const reviewer = buildAgentYaml('reviewer', 'Model/claude', 'You are a code reviewer. Review code for correctness.');
  const swarm = buildSwarmYaml(['planner', 'coder', 'reviewer'], 'planner');

  const docs: string[] = [buildPackageYaml(name), model, planner, coder, reviewer, swarm];

  return {
    'goondan.yaml': docs.join('\n---\n') + '\n',
    'prompts/planner.system.md': 'You are a planning agent. Break tasks into steps.\n',
    'prompts/coder.system.md': 'You are a coding agent. Implement the plan.\n',
    'prompts/reviewer.system.md': 'You are a code reviewer. Review code for correctness.\n',
    '.env': '# ANTHROPIC_API_KEY=sk-ant-...\n',
    '.gitignore': 'node_modules/\n.env.local\n',
  };
}

function packageTemplate(name: string): TemplateFiles {
  const pkg = buildPackageYaml(name);
  const model = buildModelYaml();
  const agent = buildAgentYaml('assistant', 'Model/claude', 'You are a helpful assistant.');
  const swarm = buildSwarmYaml(['assistant'], 'assistant');

  return {
    'goondan.yaml': [pkg, model, agent, swarm].join('\n---\n') + '\n',
    '.env': '# ANTHROPIC_API_KEY=sk-ant-...\n',
    '.gitignore': 'node_modules/\n.env.local\ndist/\n',
  };
}

function minimalTemplate(name: string): TemplateFiles {
  const model = buildModelYaml();
  const agent = buildAgentYaml('assistant', 'Model/claude', 'You are a helpful assistant.');
  const swarm = buildSwarmYaml(['assistant'], 'assistant');

  const docs: string[] = [buildPackageYaml(name), model, agent, swarm];

  return {
    'goondan.yaml': docs.join('\n---\n') + '\n',
  };
}

function generateTemplateFiles(template: InitTemplate, name: string): TemplateFiles {
  switch (template) {
    case 'default':
      return defaultTemplate(name);
    case 'multi-agent':
      return multiAgentTemplate(name);
    case 'package':
      return packageTemplate(name);
    case 'minimal':
      return minimalTemplate(name);
  }
}

async function initGitRepo(targetDir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['init'], { cwd: targetDir });
    return true;
  } catch {
    return false;
  }
}

export class DefaultInitService implements InitService {
  async init(request: InitRequest): Promise<InitResult> {
    const targetDir = request.targetDir;

    if (!request.force && (await exists(targetDir))) {
      const entries = await readdir(targetDir);
      const hasGoondan = entries.includes('goondan.yaml') || entries.includes('goondan.yml');
      if (hasGoondan) {
        throw configError(
          `${targetDir}에 이미 goondan.yaml이 존재합니다.`,
          '--force 옵션으로 덮어쓸 수 있습니다.',
        );
      }
    }

    await mkdir(targetDir, { recursive: true });

    const files = generateTemplateFiles(request.template, request.name);
    const createdFiles: string[] = [];

    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(targetDir, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      createdFiles.push(relativePath);
    }

    let gitInitialized = false;
    if (request.git) {
      gitInitialized = await initGitRepo(targetDir);
    }

    return {
      projectDir: targetDir,
      template: request.template,
      filesCreated: createdFiles,
      gitInitialized,
    };
  }
}
