/**
 * gdn init command
 *
 * Initializes a new Goondan Swarm project with the specified template.
 * @see /docs/specs/cli.md - Section 3 (gdn init)
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "../utils/prompt.js";
import { info, success, warn, error as logError } from "../utils/logger.js";

/**
 * Template types supported by the init command
 */
export type TemplateName = "default" | "multi-agent" | "package" | "minimal";

/**
 * Init command options
 */
export interface InitOptions {
  name?: string;
  template: TemplateName;
  package?: boolean;
  git: boolean;
  force: boolean;
}

/**
 * Template content generators
 */
interface TemplateFile {
  path: string;
  content: string;
}

/**
 * Generate goondan.yaml content based on template and name
 */
function generateGoonandYaml(
  name: string,
  template: TemplateName
): string {
  const apiVersion = "agents.example.io/v1alpha1";

  if (template === "minimal") {
    return `apiVersion: ${apiVersion}
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

apiVersion: ${apiVersion}
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    system: |
      You are a helpful assistant.

---

apiVersion: ${apiVersion}
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }

---

apiVersion: ${apiVersion}
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  events:
    - name: user_input

---

apiVersion: ${apiVersion}
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}
`;
  }

  if (template === "multi-agent") {
    return `apiVersion: ${apiVersion}
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

apiVersion: ${apiVersion}
kind: Agent
metadata:
  name: planner
  labels:
    role: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
    params:
      temperature: 0.3
  prompts:
    systemRef: "./prompts/planner.system.md"

---

apiVersion: ${apiVersion}
kind: Agent
metadata:
  name: executor
  labels:
    role: executor
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
    params:
      temperature: 0.7
  prompts:
    systemRef: "./prompts/executor.system.md"

---

apiVersion: ${apiVersion}
kind: Agent
metadata:
  name: reviewer
  labels:
    role: reviewer
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
    params:
      temperature: 0.5
  prompts:
    systemRef: "./prompts/reviewer.system.md"

---

apiVersion: ${apiVersion}
kind: Swarm
metadata:
  name: ${name}
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: executor }
    - { kind: Agent, name: reviewer }
  policy:
    maxStepsPerTurn: 32

---

apiVersion: ${apiVersion}
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  events:
    - name: user_input

---

apiVersion: ${apiVersion}
kind: Connection
metadata:
  name: cli-to-${name}
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}
`;
  }

  // default and package templates use similar structure
  return `apiVersion: ${apiVersion}
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5

---

apiVersion: ${apiVersion}
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    systemRef: "./prompts/default.system.md"

---

apiVersion: ${apiVersion}
kind: Swarm
metadata:
  name: ${name}
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }
  policy:
    maxStepsPerTurn: 16

---

apiVersion: ${apiVersion}
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  events:
    - name: user_input

---

apiVersion: ${apiVersion}
kind: Connection
metadata:
  name: cli-to-${name}
spec:
  connectorRef: { kind: Connector, name: cli }
  ingress:
    rules:
      - route: {}
`;
}

/**
 * Generate default system prompt
 */
function generateDefaultSystemPrompt(name: string): string {
  return `# ${name} Agent

You are a helpful AI assistant for the ${name} project.

## Guidelines

- Be helpful, harmless, and honest
- Provide clear and concise responses
- Ask for clarification when needed
- Follow the user's instructions carefully

## Capabilities

- Answer questions
- Help with tasks
- Provide information and assistance
`;
}

/**
 * Generate multi-agent prompts
 */
function generateMultiAgentPrompts(): Record<string, string> {
  return {
    "planner.system.md": `# Planner Agent

You are the Planner agent, responsible for analyzing user requests and creating execution plans.

## Responsibilities

- Analyze user requests to understand the requirements
- Break down complex tasks into smaller, manageable steps
- Coordinate with other agents to execute the plan
- Ensure the overall goal is achieved

## Guidelines

- Be thorough in your analysis
- Create clear, step-by-step plans
- Consider edge cases and potential issues
- Delegate tasks to the appropriate agents
`,
    "executor.system.md": `# Executor Agent

You are the Executor agent, responsible for carrying out tasks assigned by the Planner.

## Responsibilities

- Execute tasks as assigned by the Planner
- Report progress and results
- Handle errors gracefully
- Complete tasks efficiently and accurately

## Guidelines

- Follow instructions carefully
- Report any issues immediately
- Provide detailed results
- Work efficiently
`,
    "reviewer.system.md": `# Reviewer Agent

You are the Reviewer agent, responsible for reviewing work done by other agents.

## Responsibilities

- Review completed work for quality and correctness
- Provide feedback and suggestions for improvement
- Ensure deliverables meet requirements
- Approve or request revisions

## Guidelines

- Be thorough but fair in your reviews
- Provide constructive feedback
- Focus on quality and correctness
- Consider user requirements
`,
  };
}

/**
 * Generate .gitignore content
 */
function generateGitignore(): string {
  return `# Dependencies
node_modules/

# Build output
dist/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
.env.*.local

# Logs
logs/
*.log

# Goondan state
.goondan/

# Package manager
*.tgz
`;
}

/**
 * Generate Package YAML fragment for inclusion in goondan.yaml
 */
function generatePackageYaml(name: string): string {
  return `apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "${name}"
  version: "0.1.0"
spec:
  access: public
  dependencies: []
  exports:
    - "src/tools/example/tool.yaml"
  dist:
    - "."
`;
}

/**
 * Generate package.json for npm
 */
function generateNpmPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      description: `${name} - Goondan Package`,
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
      scripts: {
        build: "tsc",
        dev: "tsc --watch",
        test: "vitest run",
        clean: "rm -rf dist",
      },
      dependencies: {
        "@goondan/core": "^0.0.1",
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        typescript: "^5.0.0",
        vitest: "^2.0.0",
      },
      engines: {
        node: ">=18",
      },
      keywords: ["goondan", "agent", "swarm", "tool"],
      license: "MIT",
    },
    null,
    2
  );
}

/**
 * Generate tsconfig.json for TypeScript projects
 */
function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022"],
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2
  );
}

/**
 * Generate example tool files for package template
 */
function generateExampleTool(): { yaml: string; ts: string } {
  const yaml = `apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: example
  labels:
    tier: custom
spec:
  runtime: node
  entry: "./src/tools/example/index.js"
  exports:
    - name: example.hello
      description: "A simple example tool that returns a greeting"
      parameters:
        type: object
        properties:
          name:
            type: string
            description: "Name to greet"
        required:
          - name
`;

  const ts = `/**
 * Example Tool
 *
 * This is a simple example tool that demonstrates the tool structure.
 */

import type { ToolApi } from "@goondan/core";

/**
 * Tool handler interface
 */
export interface ExampleToolInput {
  name: string;
}

export interface ExampleToolOutput {
  message: string;
}

/**
 * Tool handler implementation
 */
export function register(api: ToolApi): void {
  api.register("example.hello", async (input: ExampleToolInput): Promise<ExampleToolOutput> => {
    const { name } = input;
    return {
      message: \`Hello, \${name}! Welcome to Goondan.\`,
    };
  });
}
`;

  return { yaml, ts };
}

/**
 * Get template files based on template name
 */
function getTemplateFiles(
  name: string,
  template: TemplateName,
  isPackage: boolean
): TemplateFile[] {
  const files: TemplateFile[] = [];

  // All templates get goondan.yaml
  files.push({
    path: "goondan.yaml",
    content: generateGoonandYaml(name, template),
  });

  // Add prompts based on template
  if (template === "default" || template === "package") {
    files.push({
      path: "prompts/default.system.md",
      content: generateDefaultSystemPrompt(name),
    });
  } else if (template === "multi-agent") {
    const prompts = generateMultiAgentPrompts();
    for (const [filename, content] of Object.entries(prompts)) {
      files.push({
        path: `prompts/${filename}`,
        content,
      });
    }
  }

  // Add .gitignore (except for minimal)
  if (template !== "minimal") {
    files.push({
      path: ".gitignore",
      content: generateGitignore(),
    });
  }

  // Package-specific files
  if (template === "package" || isPackage) {
    const exampleTool = generateExampleTool();

    // Prepend Package document to goondan.yaml
    const packageDoc = generatePackageYaml(name);
    const goondanFile = files.find((f) => f.path === "goondan.yaml");
    if (goondanFile) {
      goondanFile.content = packageDoc + "---\n\n" + goondanFile.content;
    }

    files.push({
      path: "package.json",
      content: generateNpmPackageJson(name),
    });

    files.push({
      path: "tsconfig.json",
      content: generateTsConfig(),
    });

    files.push({
      path: "src/tools/example/tool.yaml",
      content: exampleTool.yaml,
    });

    files.push({
      path: "src/tools/example/index.ts",
      content: exampleTool.ts,
    });

    // Update .gitignore for package template
    const gitignoreIndex = files.findIndex((f) => f.path === ".gitignore");
    if (gitignoreIndex === -1) {
      files.push({
        path: ".gitignore",
        content: generateGitignore(),
      });
    }
  }

  return files;
}

/**
 * Check if a directory is empty or contains only hidden files
 */
function isDirectoryEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  const files = fs.readdirSync(dirPath);
  return files.filter((f) => !f.startsWith(".")).length === 0;
}

/**
 * Initialize git repository
 */
function initGitRepo(projectPath: string): boolean {
  try {
    execSync("git init", { cwd: projectPath, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute the init command logic
 *
 * @param targetPath - Target directory path
 * @param initOptions - Parsed init options
 */
async function executeInit(
  targetPath: string,
  initOptions: InitOptions
): Promise<void> {
  const spinner = ora();

  try {
    // Resolve project path
    const projectPath = path.resolve(process.cwd(), targetPath);
    const projectDirName = path.basename(projectPath);

    // Determine project name
    const projectName = initOptions.name ?? projectDirName;

    // Validate template
    const validTemplates: TemplateName[] = [
      "default",
      "multi-agent",
      "package",
      "minimal",
    ];
    if (!validTemplates.includes(initOptions.template)) {
      logError(`Invalid template: ${initOptions.template}`);
      info(`Valid templates: ${validTemplates.join(", ")}`);
      process.exitCode = 2;
      return;
    }

    // If --package is specified, use package template
    const effectiveTemplate: TemplateName =
      initOptions.package && initOptions.template === "default"
        ? "package"
        : initOptions.template;

    // Check if directory exists and is not empty
    if (!initOptions.force && !isDirectoryEmpty(projectPath)) {
      const shouldContinue = await confirm(
        `Directory ${targetPath} is not empty. Continue anyway?`,
        { initial: false }
      );

      if (!shouldContinue) {
        warn("Aborted.");
        return;
      }
    }

    // Start initialization
    console.log();
    console.log(
      chalk.bold(`Initializing Goondan project: ${chalk.cyan(projectName)}`)
    );
    console.log(chalk.gray(`Template: ${effectiveTemplate}`));
    console.log(chalk.gray(`Path: ${projectPath}`));
    console.log();

    // Create project directory
    spinner.start("Creating project structure...");
    fs.mkdirSync(projectPath, { recursive: true });

    // Get template files
    const files = getTemplateFiles(
      projectName,
      effectiveTemplate,
      initOptions.package ?? false
    );

    // Write files
    for (const file of files) {
      const filePath = path.join(projectPath, file.path);
      const fileDir = path.dirname(filePath);

      // Create directory if needed
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      // Check if file exists and --force is not specified
      if (fs.existsSync(filePath) && !initOptions.force) {
        spinner.warn(`Skipping existing file: ${file.path}`);
        continue;
      }

      // Write file
      fs.writeFileSync(filePath, file.content, "utf8");
    }

    spinner.succeed("Project structure created");

    // Initialize git repository
    if (initOptions.git) {
      spinner.start("Initializing git repository...");
      const gitInitialized = initGitRepo(projectPath);
      if (gitInitialized) {
        spinner.succeed("Git repository initialized");
      } else {
        spinner.warn("Failed to initialize git repository");
      }
    }

    // Success message
    console.log();
    success("Project initialized successfully!");
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log();

    if (targetPath !== ".") {
      console.log(chalk.gray(`  cd ${targetPath}`));
    }

    if (effectiveTemplate === "package") {
      console.log(chalk.gray("  npm install      # Install dependencies"));
      console.log(chalk.gray("  npm run build    # Build the package"));
    }

    console.log(chalk.gray("  gdn validate     # Validate configuration"));
    console.log(chalk.gray("  gdn run          # Start the Swarm"));
    console.log();

    // Template-specific hints
    if (effectiveTemplate === "multi-agent") {
      console.log(chalk.dim("Tip: Edit prompts in the prompts/ directory to customize agent behavior."));
    } else if (effectiveTemplate === "package") {
      console.log(chalk.dim("Tip: Add more tools in src/tools/ and reference them in goondan.yaml."));
    } else if (effectiveTemplate === "minimal") {
      console.log(chalk.dim("Tip: This minimal config is great for quick experiments."));
    }

    console.log();
  } catch (err) {
    spinner.fail("Failed to initialize project");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Execute init command (for cli.ts integration)
 *
 * @param targetPath - Target directory path
 * @param options - Raw command options
 * @param _ctx - Command context (unused, for interface compatibility)
 */
export async function executeInitCommand(
  targetPath: string,
  options: Record<string, unknown>,
  _ctx: unknown
): Promise<void> {
  const initOptions: InitOptions = {
    name: options.name as string | undefined,
    template: (options.template as TemplateName) ?? "default",
    package: options.package as boolean | undefined,
    git: options.git !== false,
    force: (options.force as boolean) ?? false,
  };

  await executeInit(targetPath, initOptions);
}

// Alias for backward compatibility with cli.ts
export { executeInitCommand as executeInit };

/**
 * Create the init command
 *
 * @returns Commander command for 'gdn init'
 */
export function createInitCommand(): Command {
  const command = new Command("init")
    .description("Initialize a new Goondan Swarm project")
    .addHelpText(
      "after",
      `
Examples:
  $ gdn init                             Create project in current directory
  $ gdn init ./my-agent                  Create project in new directory
  $ gdn init -t multi-agent              Multi-agent template
  $ gdn init -t minimal                  Minimal single-file config
  $ gdn init --package -n @org/tools     Initialize as Package`
    )
    .argument("[path]", "Project directory path", ".")
    .option("-n, --name <name>", "Swarm name")
    .option(
      "-t, --template <template>",
      "Template to use (default, multi-agent, package, minimal)",
      "default"
    )
    .option("--package", "Initialize as a Package", false)
    .option("--git", "Initialize git repository", true)
    .option("--no-git", "Skip git repository initialization")
    .option("-f, --force", "Overwrite existing files", false)
    .action(async (targetPath: string, options: Record<string, unknown>) => {
      // Parse options into typed InitOptions
      const initOptions: InitOptions = {
        name: options.name as string | undefined,
        template: (options.template as TemplateName) ?? "default",
        package: options.package as boolean | undefined,
        git: options.git !== false, // default true
        force: (options.force as boolean) ?? false,
      };

      await executeInit(targetPath, initOptions);
    });

  return command;
}

export default createInitCommand;
