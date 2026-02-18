# Getting Started

> Install Goondan, create your first project, and have a conversation with an AI agent -- all in under 5 minutes.

[Korean version (한국어)](./01-getting-started.ko.md)

---

## What you will build

By the end of this tutorial, you will have:

- A Goondan project with a `goondan.yaml` configuration file
- A single AI agent powered by Claude (or another LLM)
- An interactive CLI session where you can chat with your agent

No prior Goondan experience is required. If you know how to open a terminal and edit a text file, you are ready.

---

## Prerequisites

Before you begin, make sure you have these two things:

### 1. Install Bun

Goondan runs on [Bun](https://bun.sh), a fast JavaScript runtime. Install it:

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify the installation:

```bash
bun -v
```

**Expected output:**

```
1.x.x
```

If you see a version number, you are good to go.

### 2. Get an LLM API key

You need an API key from at least one LLM provider. Goondan supports:

| Provider | Environment variable | Where to get a key |
|----------|---------------------|--------------------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/) |

This tutorial uses Anthropic (Claude) as the default. You can switch to another provider in [Step 4](#step-4-configure-environment-variables).

---

## Step 1: Install the Goondan CLI

Install the `gdn` command-line tool globally:

```bash
bun add -g @goondan/cli
```

Verify:

```bash
gdn --version
```

**Expected output:**

```
0.0.3
```

> **Alternative package managers**: You can also use `npm install -g @goondan/cli` or `pnpm add -g @goondan/cli`, but Bun is recommended for the best experience.

---

## Step 2: Create a new project

Use `gdn init` to scaffold a new Goondan project:

```bash
gdn init my-first-swarm
cd my-first-swarm
```

**Expected output:**

```
Created my-first-swarm/goondan.yaml
Created my-first-swarm/prompts/default.system.md
Created my-first-swarm/.env
Created my-first-swarm/.gitignore
Initialized git repository
```

This creates the following file structure:

```
my-first-swarm/
  goondan.yaml           # Main configuration file
  prompts/
    default.system.md    # System prompt for the agent
  .env                   # Environment variable template
  .gitignore             # Git ignore rules
```

> **Tip**: You can also run `gdn init` without a path to initialize in the current directory, or use `gdn init --template multi-agent` for a multi-agent setup. See [CLI Reference: `gdn init`](../reference/cli-reference.md#gdn-init) for all options.

---

## Step 3: Understand `goondan.yaml`

Open `goondan.yaml` in your editor. You will see four resource documents separated by `---`:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: "my-first-swarm"
spec:
  version: "0.1.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompts:
    systemPrompt: |
      You are a helpful assistant.
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
```

Here is what each resource does:

| Resource | Role |
|----------|------|
| **Package** | Project metadata. Required for `gdn run`. Must be the first document. |
| **Model** | Defines which LLM to use and how to authenticate. The `valueFrom.env` pattern reads the API key from your `.env` file -- your secrets never live in YAML. |
| **Agent** | The unit of computation. References a Model and defines a system prompt that shapes the agent's behavior. |
| **Swarm** | Groups agents together and sets the entry point. `entryAgent` is the agent that receives the first message. |

### How data flows

```
User input (CLI)
  --> Swarm (routes to entryAgent)
    --> Agent (uses Model to generate responses)
      --> Model (calls the LLM API)
```

### ObjectRef: how resources reference each other

Notice `modelRef: "Model/claude"` and `entryAgent: "Agent/assistant"`. These use the **ObjectRef** format: `Kind/name`. This is how resources link to each other. If you mistype a reference, `gdn validate` will catch it before anything runs.

> **Want to go deeper?** See [Core Concepts](../explanation/core-concepts.md) for a thorough explanation of the resource model, ObjectRef, ValueSource, and instanceKey.

---

## Step 4: Configure environment variables

Open the `.env` file and add your API key:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Using a different provider?** Update both the `.env` file and the Model resource in `goondan.yaml`:

For **OpenAI**:

```bash
# .env
OPENAI_API_KEY=sk-your-key-here
```

```yaml
# In goondan.yaml, replace the Model document:
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude   # You can rename this to "openai" if you prefer
spec:
  provider: openai
  model: gpt-4o
  apiKey:
    valueFrom:
      env: OPENAI_API_KEY
```

For **Google (Gemini)**:

```bash
# .env
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

```yaml
# In goondan.yaml, replace the Model document:
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude   # You can rename this to "gemini" if you prefer
spec:
  provider: google
  model: gemini-2.0-flash
  apiKey:
    valueFrom:
      env: GOOGLE_GENERATIVE_AI_API_KEY
```

> **Security note**: Never commit `.env` files to version control. The generated `.gitignore` already includes `.env.local`. For team projects, use `.env` as a template with placeholder values and `.env.local` for real keys.

---

## Step 5: Validate your configuration

Before running, verify that everything is correctly configured:

```bash
gdn validate
```

**Expected output (success):**

```
Validating /path/to/my-first-swarm...

  Schema validation passed
  Reference integrity passed
  File existence check passed
  Naming convention check passed

Errors: 0, Warnings: 0
```

**If validation fails**, here are common issues:

| Error | Cause | Fix |
|-------|-------|-----|
| "Package document not found" | First document is not `kind: Package` | Make sure `kind: Package` is the first `---` section |
| "Model/xxx not found" | Agent references a non-existent Model | Check `modelRef` matches a Model's `metadata.name` |
| "ANTHROPIC_API_KEY not set" | Environment variable missing | Add it to `.env` |

> See [CLI Reference: `gdn validate`](../reference/cli-reference.md#gdn-validate) for validation details and JSON output format.

---

## Step 6: Run your swarm

Start the swarm in foreground mode so you can interact with it directly:

```bash
gdn run --foreground
```

**Expected output:**

```
Orchestrator started (instanceKey: default)
Connector: cli ready
>
```

The `>` prompt means the agent is ready and waiting for your input.

### What happens behind the scenes

1. Goondan parses `goondan.yaml` and validates all resources
2. The Orchestrator starts as a persistent process
3. The CLI Connector activates, providing an interactive prompt
4. When you type a message, it routes through the Swarm to the entry Agent
5. The Agent calls the LLM API and streams the response back

---

## Step 7: Talk to your agent

Type a message at the `>` prompt:

```
> Hello! What can you help me with?
```

**Expected output (example):**

```
Hello! I'm a helpful assistant. I can help you with a wide range of tasks, including:

- Answering questions on various topics
- Writing and editing text
- Explaining concepts
- Problem-solving and brainstorming
- And much more!

What would you like help with today?
>
```

Try a few more messages to see the agent in action:

```
> Explain what "Kubernetes for Agent Swarm" means in one paragraph.
```

The agent maintains conversation history within the session, so it remembers what you discussed earlier.

### Stop the swarm

Press **Ctrl+C** to stop the Orchestrator and return to your shell.

---

## Step 8: Verify your project works end-to-end

Let's run a quick checklist to confirm everything is set up correctly:

```bash
# 1. Validate configuration
gdn validate

# 2. Check if any instances are running
gdn instance list

# 3. Check environment
gdn doctor
```

`gdn doctor` shows a comprehensive report of your environment:

```
Goondan Doctor
Checking your environment...

System
  Bun: Bun 1.x.x

API Keys
  Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)

Project
  Bundle Config: Found goondan.yaml
  Bundle Validation: Valid (4 resources)

Summary
  4 passed, 0 warnings, 0 errors
```

If everything passes, your Goondan installation is complete and working.

---

## What you learned

In this tutorial, you:

1. Installed Bun and the Goondan CLI (`gdn`)
2. Created a new project with `gdn init`
3. Learned the structure of `goondan.yaml` (Package, Model, Agent, Swarm)
4. Configured an API key securely using `.env` and `valueFrom.env`
5. Validated configuration with `gdn validate`
6. Ran a swarm and had an interactive conversation with `gdn run --foreground`
7. Verified the setup with `gdn doctor`

---

## Next steps

Now that you have a working swarm, here are some paths to explore:

### Add tools to your agent

Give your agent the ability to execute shell commands, read files, or call HTTP APIs by adding tools from `@goondan/base`:

1. Add the base package: `gdn package add @goondan/base`
2. Install it: `gdn package install`
3. Add tools to your Agent in `goondan.yaml`:

```yaml
spec:
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

> See [How to: Use Built-in Tools](../how-to/use-builtin-tools.md) for the full list of available tools.

### Build a custom tool

Create your own tool that agents can invoke:

> See [Tutorial: Build Your First Tool](./02-build-your-first-tool.md) for a step-by-step guide.

### Build a custom extension

Create middleware that hooks into the turn/step/toolCall pipeline:

> See [Tutorial: Build Your First Extension](./03-build-your-first-extension.md) for a step-by-step guide.

### Connect to external channels

Replace the CLI Connector with Telegram or Slack to let your agent communicate through messaging platforms:

> See [How to: Run a Swarm](../how-to/run-a-swarm.md) for Connection setup examples.

### Learn the core concepts

Understand the resource model, ObjectRef, instanceKey, and the "Kubernetes for Agent Swarm" philosophy:

> See [Core Concepts](../explanation/core-concepts.md) for a comprehensive explanation.

---

## See also

- [How to: Run a Swarm](../how-to/run-a-swarm.md) -- Launch, restart, and manage swarm instances
- [Core Concepts](../explanation/core-concepts.md) -- Resource Kinds, ObjectRef, instanceKey, Bundle, Package
- [CLI Reference](../reference/cli-reference.md) -- Full `gdn` command reference
- [Resources Reference](../reference/resources.md) -- YAML schema for all 8 resource Kinds

---

_Wiki version: v0.0.3_
