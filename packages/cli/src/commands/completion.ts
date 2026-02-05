/**
 * gdn completion command
 *
 * Generate shell completion scripts for bash, zsh, fish, and powershell.
 *
 * @see /docs/specs/cli.md - Section 10 (gdn completion)
 */

import { Command } from "commander";
import { error as logError, info } from "../utils/logger.js";
import { ExitCode } from "../types.js";
import { CLI_NAME } from "../cli.js";

/**
 * Supported shells
 */
export type Shell = "bash" | "zsh" | "fish" | "powershell";

/**
 * Check if a shell is valid
 */
function isValidShell(shell: string): shell is Shell {
  return ["bash", "zsh", "fish", "powershell"].includes(shell);
}

/**
 * Generate bash completion script
 */
function generateBashCompletion(): string {
  return `# Bash completion for ${CLI_NAME}
# Add to ~/.bashrc: eval "$(${CLI_NAME} completion bash)"

_${CLI_NAME}_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="init run validate package instance logs config completion"
  local package_commands="install add remove update list publish login logout pack info cache"
  local instance_commands="list inspect delete resume"
  local config_commands="get set list delete path"
  local global_options="--help --version --verbose --quiet --config --state-root --no-color --json"

  case "\${words[1]}" in
    init)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "--name --template --package --git --no-git --force \${global_options}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -d -- "\${cur}") )
      fi
      ;;
    run)
      COMPREPLY=( $(compgen -W "--swarm --connector --instance-key --input --input-file --interactive --no-interactive --watch --port --no-install \${global_options}" -- "\${cur}") )
      ;;
    validate)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "--strict --fix --format \${global_options}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -fd -- "\${cur}") )
      fi
      ;;
    package)
      case "\${words[2]}" in
        install)
          COMPREPLY=( $(compgen -W "--frozen-lockfile --ignore-scripts --production \${global_options}" -- "\${cur}") )
          ;;
        add)
          COMPREPLY=( $(compgen -W "--dev --exact --registry \${global_options}" -- "\${cur}") )
          ;;
        remove|update|info)
          COMPREPLY=( $(compgen -W "\${global_options}" -- "\${cur}") )
          ;;
        list)
          COMPREPLY=( $(compgen -W "--depth --all \${global_options}" -- "\${cur}") )
          ;;
        publish|pack)
          if [[ "\${cur}" == -* ]]; then
            COMPREPLY=( $(compgen -W "--tag --access --dry-run --registry --out \${global_options}" -- "\${cur}") )
          else
            COMPREPLY=( $(compgen -d -- "\${cur}") )
          fi
          ;;
        login|logout)
          COMPREPLY=( $(compgen -W "--registry --scope --token \${global_options}" -- "\${cur}") )
          ;;
        cache)
          COMPREPLY=( $(compgen -W "info clean" -- "\${cur}") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "\${package_commands}" -- "\${cur}") )
          ;;
      esac
      ;;
    instance)
      case "\${words[2]}" in
        list)
          COMPREPLY=( $(compgen -W "--swarm --limit --all \${global_options}" -- "\${cur}") )
          ;;
        inspect|delete|resume)
          COMPREPLY=( $(compgen -W "\${global_options}" -- "\${cur}") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "\${instance_commands}" -- "\${cur}") )
          ;;
      esac
      ;;
    logs)
      COMPREPLY=( $(compgen -W "--agent --type --follow --tail --since --until --turn \${global_options}" -- "\${cur}") )
      ;;
    config)
      case "\${words[2]}" in
        get|set|delete)
          local config_keys="registry stateRoot logLevel color editor"
          COMPREPLY=( $(compgen -W "\${config_keys}" -- "\${cur}") )
          ;;
        path)
          COMPREPLY=( $(compgen -W "global project all" -- "\${cur}") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "\${config_commands}" -- "\${cur}") )
          ;;
      esac
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\${cur}") )
      ;;
    *)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${global_options}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      fi
      ;;
  esac
}

complete -F _${CLI_NAME}_completions ${CLI_NAME}
`;
}

/**
 * Generate zsh completion script
 */
function generateZshCompletion(): string {
  return `#compdef ${CLI_NAME}
# Zsh completion for ${CLI_NAME}
# Add to ~/.zshrc: eval "$(${CLI_NAME} completion zsh)"

_${CLI_NAME}() {
  local state

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      local commands=(
        'init:Initialize a new Swarm project'
        'run:Run a Swarm'
        'validate:Validate Bundle configuration'
        'package:Manage Bundle packages'
        'instance:Manage Swarm instances'
        'logs:View instance logs'
        'config:Manage CLI configuration'
        'completion:Generate shell completion script'
      )
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        init)
          _arguments \\
            '(-n --name)'{-n,--name}'[Swarm name]:name:' \\
            '(-t --template)'{-t,--template}'[Template to use]:template:(default multi-agent package minimal)' \\
            '--package[Initialize as Bundle Package]' \\
            '--git[Initialize Git repository]' \\
            '--no-git[Do not initialize Git repository]' \\
            '(-f --force)'{-f,--force}'[Force overwrite existing files]' \\
            '*:directory:_directories'
          ;;
        run)
          _arguments \\
            '(-s --swarm)'{-s,--swarm}'[Swarm name to run]:swarm:' \\
            '--connector[Connector to use]:connector:' \\
            '(-i --instance-key)'{-i,--instance-key}'[Instance key]:key:' \\
            '--input[Initial input message]:text:' \\
            '--input-file[Input from file]:file:_files' \\
            '--interactive[Interactive mode]' \\
            '--no-interactive[Disable interactive mode]' \\
            '(-w --watch)'{-w,--watch}'[Watch mode for file changes]' \\
            '(-p --port)'{-p,--port}'[HTTP server port]:port:' \\
            '--no-install[Skip dependency installation]'
          ;;
        validate)
          _arguments \\
            '--strict[Treat warnings as errors]' \\
            '--fix[Auto-fix fixable issues]' \\
            '--format[Output format]:format:(text json github)' \\
            '*:path:_files'
          ;;
        package)
          local -a package_cmds
          package_cmds=(
            'install:Install dependencies'
            'add:Add a dependency'
            'remove:Remove a dependency'
            'update:Update dependencies'
            'list:List installed packages'
            'publish:Publish package to registry'
            'login:Login to registry'
            'logout:Logout from registry'
            'pack:Create local tarball'
            'info:Show package information'
            'cache:Manage package cache'
          )
          _describe 'package command' package_cmds
          ;;
        instance)
          local -a instance_cmds
          instance_cmds=(
            'list:List instances'
            'inspect:Inspect an instance'
            'delete:Delete an instance'
            'resume:Resume an instance'
          )
          _describe 'instance command' instance_cmds
          ;;
        logs)
          _arguments \\
            '(-a --agent)'{-a,--agent}'[Filter by agent name]:agent:' \\
            '(-t --type)'{-t,--type}'[Log type]:type:(messages events all)' \\
            '(-f --follow)'{-f,--follow}'[Stream logs in real-time]' \\
            '--tail[Show last n lines]:lines:' \\
            '--since[Show logs since time]:time:' \\
            '--until[Show logs until time]:time:' \\
            '--turn[Filter by turn ID]:turn:'
          ;;
        config)
          local -a config_cmds
          config_cmds=(
            'get:Get a configuration value'
            'set:Set a configuration value'
            'list:List all configuration'
            'delete:Delete a configuration value'
            'path:Show config file path'
          )
          _describe 'config command' config_cmds
          ;;
        completion)
          _arguments '1:shell:(bash zsh fish powershell)'
          ;;
      esac
      ;;
  esac
}

_${CLI_NAME} "$@"
`;
}

/**
 * Generate fish completion script
 */
function generateFishCompletion(): string {
  return `# Fish completion for ${CLI_NAME}
# Save to ~/.config/fish/completions/${CLI_NAME}.fish

# Disable file completion by default
complete -c ${CLI_NAME} -f

# Main commands
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "init" -d "Initialize a new Swarm project"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "run" -d "Run a Swarm"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "validate" -d "Validate Bundle configuration"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "package" -d "Manage Bundle packages"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "instance" -d "Manage Swarm instances"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "logs" -d "View instance logs"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "config" -d "Manage CLI configuration"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"

# Global options
complete -c ${CLI_NAME} -l help -s h -d "Show help"
complete -c ${CLI_NAME} -l version -s V -d "Show version"
complete -c ${CLI_NAME} -l verbose -s v -d "Enable verbose output"
complete -c ${CLI_NAME} -l quiet -s q -d "Minimize output"
complete -c ${CLI_NAME} -l config -s c -d "Configuration file path"
complete -c ${CLI_NAME} -l state-root -d "System state root path"
complete -c ${CLI_NAME} -l no-color -d "Disable color output"
complete -c ${CLI_NAME} -l json -d "Output in JSON format"

# init options
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l name -s n -d "Swarm name"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l template -s t -a "default multi-agent package minimal" -d "Template to use"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l package -d "Initialize as Bundle Package"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l git -d "Initialize Git repository"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l no-git -d "Do not initialize Git"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from init" -l force -s f -d "Force overwrite"

# run options
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l swarm -s s -d "Swarm name to run"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l connector -d "Connector to use"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l instance-key -s i -d "Instance key"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l input -d "Initial input message"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l input-file -d "Input from file"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l interactive -d "Interactive mode"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l no-interactive -d "Disable interactive mode"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l watch -s w -d "Watch mode"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l port -s p -d "HTTP server port"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from run" -l no-install -d "Skip dependency installation"

# validate options
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from validate" -l strict -d "Treat warnings as errors"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from validate" -l fix -d "Auto-fix fixable issues"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from validate" -l format -a "text json github" -d "Output format"

# package subcommands
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "install" -d "Install dependencies"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "add" -d "Add a dependency"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "remove" -d "Remove a dependency"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "update" -d "Update dependencies"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "list" -d "List installed packages"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "publish" -d "Publish package"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "login" -d "Login to registry"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "logout" -d "Logout from registry"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "pack" -d "Create tarball"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "info" -d "Package info"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from package; and not __fish_seen_subcommand_from install add remove update list publish login logout pack info cache" -a "cache" -d "Manage cache"

# instance subcommands
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from instance; and not __fish_seen_subcommand_from list inspect delete resume" -a "list" -d "List instances"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from instance; and not __fish_seen_subcommand_from list inspect delete resume" -a "inspect" -d "Inspect instance"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from instance; and not __fish_seen_subcommand_from list inspect delete resume" -a "delete" -d "Delete instance"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from instance; and not __fish_seen_subcommand_from list inspect delete resume" -a "resume" -d "Resume instance"

# logs options
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l agent -s a -d "Filter by agent name"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l type -s t -a "messages events all" -d "Log type"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l follow -s f -d "Stream logs"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l tail -d "Show last n lines"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l since -d "Show logs since time"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l until -d "Show logs until time"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from logs" -l turn -d "Filter by turn ID"

# config subcommands
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list delete path" -a "get" -d "Get config value"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list delete path" -a "set" -d "Set config value"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list delete path" -a "list" -d "List all config"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list delete path" -a "delete" -d "Delete config value"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list delete path" -a "path" -d "Show config path"

# config keys
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set delete" -a "registry stateRoot logLevel color editor" -d "Config key"

# completion shells
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell" -d "Shell type"
`;
}

/**
 * Generate PowerShell completion script
 */
function generatePowerShellCompletion(): string {
  return `# PowerShell completion for ${CLI_NAME}
# Add to your $PROFILE: . (${CLI_NAME} completion powershell)

$script:commands = @('init', 'run', 'validate', 'package', 'instance', 'logs', 'config', 'completion')
$script:packageCommands = @('install', 'add', 'remove', 'update', 'list', 'publish', 'login', 'logout', 'pack', 'info', 'cache')
$script:instanceCommands = @('list', 'inspect', 'delete', 'resume')
$script:configCommands = @('get', 'set', 'list', 'delete', 'path')
$script:configKeys = @('registry', 'stateRoot', 'logLevel', 'color', 'editor')
$script:shells = @('bash', 'zsh', 'fish', 'powershell')

Register-ArgumentCompleter -Native -CommandName ${CLI_NAME} -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.ToString().Split(' ') | Where-Object { $_ -ne '' }
    $tokenCount = $tokens.Count

    # Main command completion
    if ($tokenCount -le 1 -or ($tokenCount -eq 2 -and $wordToComplete)) {
        $script:commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    $mainCommand = $tokens[1]

    switch ($mainCommand) {
        'package' {
            if ($tokenCount -le 2 -or ($tokenCount -eq 3 -and $wordToComplete)) {
                $script:packageCommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'instance' {
            if ($tokenCount -le 2 -or ($tokenCount -eq 3 -and $wordToComplete)) {
                $script:instanceCommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'config' {
            if ($tokenCount -le 2 -or ($tokenCount -eq 3 -and $wordToComplete)) {
                $script:configCommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            } elseif ($tokens[2] -in @('get', 'set', 'delete')) {
                $script:configKeys | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'completion' {
            if ($tokenCount -le 2 -or ($tokenCount -eq 3 -and $wordToComplete)) {
                $script:shells | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
    }
}
`;
}

/**
 * Generate completion script for a shell
 */
function generateCompletion(shell: Shell): string {
  switch (shell) {
    case "bash":
      return generateBashCompletion();
    case "zsh":
      return generateZshCompletion();
    case "fish":
      return generateFishCompletion();
    case "powershell":
      return generatePowerShellCompletion();
  }
}

/**
 * Execute the completion command
 */
function executeCompletion(shell: string): void {
  if (!isValidShell(shell)) {
    logError(`Invalid shell: ${shell}`);
    info("Supported shells: bash, zsh, fish, powershell");
    process.exitCode = ExitCode.INVALID_ARGS;
    return;
  }

  const script = generateCompletion(shell);
  console.log(script);
}

/**
 * Create the completion command
 *
 * @returns Commander command for 'gdn completion'
 */
export function createCompletionCommand(): Command {
  const command = new Command("completion")
    .description("Generate shell completion script")
    .argument("<shell>", "Shell type (bash, zsh, fish, powershell)")
    .action((shell: string) => {
      executeCompletion(shell);
    });

  return command;
}

export default createCompletionCommand;
