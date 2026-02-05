/**
 * Logger utility for CLI output
 *
 * Respects --verbose, --quiet, --no-color, --json flags
 * @see /docs/specs/cli.md
 */
import chalk, { type ChalkInstance } from "chalk";

/**
 * Log levels in order of verbosity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Enable verbose output (shows debug level) */
  verbose?: boolean;
  /** Minimize output (only show errors and json output) */
  quiet?: boolean;
  /** Disable color output */
  noColor?: boolean;
  /** Output in JSON format */
  json?: boolean;
}

/**
 * JSON log entry structure
 */
export interface JsonLogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Logger instance type
 */
export interface Logger {
  /** Log debug message (only in verbose mode) */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Log info message */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log warning message */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Log error message */
  error(message: string, data?: Record<string, unknown>): void;
  /** Log success message (info level with green checkmark) */
  success(message: string, data?: Record<string, unknown>): void;
  /** Output JSON data directly */
  json(data: unknown): void;
  /** Update logger options */
  configure(options: LoggerOptions): void;
  /** Get current options */
  getOptions(): Readonly<LoggerOptions>;
}

/**
 * Global logger options
 */
let globalOptions: LoggerOptions = {
  verbose: false,
  quiet: false,
  noColor: false,
  json: false,
};

/**
 * Get chalk instance respecting color settings
 */
function getChalk(): ChalkInstance {
  if (globalOptions.noColor) {
    // Use plain chalk but we'll check noColor flag in formatting
    return chalk;
  }
  return chalk;
}

/**
 * Check if colors should be disabled
 */
function isNoColor(): boolean {
  return globalOptions.noColor === true;
}

/**
 * Check if a log level should be output based on current options
 */
function shouldOutput(level: LogLevel): boolean {
  if (globalOptions.quiet) {
    // In quiet mode, only show errors
    return level === "error";
  }

  if (!globalOptions.verbose && level === "debug") {
    // Debug only shown in verbose mode
    return false;
  }

  return true;
}

/**
 * Format timestamp for JSON output
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Write to stdout
 */
function writeStdout(message: string): void {
  process.stdout.write(message + "\n");
}

/**
 * Write to stderr
 */
function writeStderr(message: string): void {
  process.stderr.write(message + "\n");
}

/**
 * Format message for text output
 */
function formatTextMessage(
  level: LogLevel,
  message: string,
  prefix?: string
): string {
  const c = getChalk();

  if (isNoColor()) {
    switch (level) {
      case "debug":
        return `[debug] ${message}`;
      case "info":
        if (prefix) {
          return `${prefix} ${message}`;
        }
        return message;
      case "warn":
        return `warning: ${message}`;
      case "error":
        return `error: ${message}`;
    }
  }

  switch (level) {
    case "debug":
      return c.gray(`[debug] ${message}`);
    case "info":
      if (prefix) {
        return `${prefix} ${message}`;
      }
      return message;
    case "warn":
      return c.yellow(`${c.bold("warning:")} ${message}`);
    case "error":
      return c.red(`${c.bold("error:")} ${message}`);
  }
}

/**
 * Output a log entry
 */
function outputLog(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  prefix?: string
): void {
  if (!shouldOutput(level)) {
    return;
  }

  if (globalOptions.json) {
    const entry: JsonLogEntry = {
      level,
      message,
      timestamp: formatTimestamp(),
    };
    if (data) {
      entry.data = data;
    }
    // Always use stdout for JSON
    writeStdout(JSON.stringify(entry));
    return;
  }

  const formattedMessage = formatTextMessage(level, message, prefix);

  if (level === "error" || level === "warn") {
    writeStderr(formattedMessage);
  } else {
    writeStdout(formattedMessage);
  }

  // Output additional data in verbose mode
  if (data && globalOptions.verbose) {
    const c = getChalk();
    writeStdout(c.gray(JSON.stringify(data, null, 2)));
  }
}

/**
 * Create logger instance
 */
function createLoggerInstance(): Logger {
  return {
    debug(message: string, data?: Record<string, unknown>): void {
      outputLog("debug", message, data);
    },

    info(message: string, data?: Record<string, unknown>): void {
      outputLog("info", message, data);
    },

    warn(message: string, data?: Record<string, unknown>): void {
      outputLog("warn", message, data);
    },

    error(message: string, data?: Record<string, unknown>): void {
      outputLog("error", message, data);
    },

    success(message: string, data?: Record<string, unknown>): void {
      const c = getChalk();
      const prefix = c.green("\u2713");
      outputLog("info", message, data, prefix);
    },

    json(data: unknown): void {
      // JSON output always goes to stdout, regardless of quiet mode
      writeStdout(JSON.stringify(data, null, globalOptions.json ? 0 : 2));
    },

    configure(options: LoggerOptions): void {
      globalOptions = { ...globalOptions, ...options };
    },

    getOptions(): Readonly<LoggerOptions> {
      return { ...globalOptions };
    },
  };
}

/**
 * Default logger instance
 */
export const logger = createLoggerInstance();

// Export convenience functions that use the global logger
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const success = logger.success.bind(logger);
export const json = logger.json.bind(logger);

/**
 * Configure the global logger
 */
export function configureLogger(options: LoggerOptions): void {
  logger.configure(options);
}

/**
 * Get current logger options
 */
export function getLoggerOptions(): Readonly<LoggerOptions> {
  return logger.getOptions();
}
