/**
 * CLI Types
 *
 * Type definitions for the Goondan CLI.
 */

/**
 * Global CLI options available to all commands
 */
export interface GlobalOptions {
  /** Enable verbose output */
  verbose: boolean;
  /** Minimize output */
  quiet: boolean;
  /** Config file path */
  config: string;
  /** System State Root path */
  stateRoot: string;
  /** Disable colored output */
  color: boolean;
  /** Output in JSON format */
  json: boolean;
}

/**
 * CLI configuration from ~/.goondanrc
 */
export interface CliConfig {
  /** Default package registry URL */
  registry?: string;
  /** System State Root path */
  stateRoot?: string;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Enable colored output */
  color?: boolean;
  /** Default editor */
  editor?: string;
  /** Registry authentication tokens */
  registries?: Record<string, RegistryAuth>;
  /** Scoped registry mappings */
  scopedRegistries?: Record<string, string>;
}

/**
 * Registry authentication info
 */
export interface RegistryAuth {
  /** Authentication token */
  token: string;
}

/**
 * CLI exit codes
 */
export const ExitCode = {
  /** Success */
  SUCCESS: 0,
  /** General error */
  ERROR: 1,
  /** Invalid arguments/options */
  INVALID_ARGS: 2,
  /** Configuration error */
  CONFIG_ERROR: 3,
  /** Validation error */
  VALIDATION_ERROR: 4,
  /** Network error */
  NETWORK_ERROR: 5,
  /** Authentication error */
  AUTH_ERROR: 6,
  /** User interrupt (Ctrl+C) */
  INTERRUPT: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
