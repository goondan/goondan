/**
 * gdn validate command
 *
 * Validates Bundle configuration with various checks:
 * - Schema validation for all resources
 * - Reference integrity (ObjectRef targets exist)
 * - File existence (entry, systemRef paths)
 * - Naming convention (lowercase with hyphens)
 *
 * @see /docs/specs/cli.md - Section 5 (gdn validate)
 * @see /docs/specs/bundle.md - Section 6 (Validation)
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  loadBundleFromDirectory,
  loadBundleFromFile,
  BundleError,
  ParseError,
  ValidationError,
  ReferenceError,
  type BundleLoadResult,
  type Resource,
} from "@goondan/core";
import { info, success, warn, error as logError } from "../utils/logger.js";

/**
 * Output format types
 */
export type OutputFormat = "text" | "json" | "github";

/**
 * Validate command options
 */
export interface ValidateOptions {
  strict: boolean;
  fix: boolean;
  format: OutputFormat;
}

/**
 * Validation issue structure
 */
export interface ValidationIssue {
  code: string;
  message: string;
  level: "error" | "warning";
  resource?: string;
  path?: string;
  field?: string;
  file?: string;
  line?: number;
  suggestion?: string;
  helpUrl?: string;
}

/**
 * Validation result structure
 */
export interface ValidateResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  resourceCount: number;
  sources: string[];
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract file paths from resources that need existence checks
 */
function extractFilePaths(
  resources: Resource[],
  bundleRoot: string
): Array<{ path: string; resource: string; field: string }> {
  const paths: Array<{ path: string; resource: string; field: string }> = [];

  for (const resource of resources) {
    const resourceId = `${resource.kind}/${resource.metadata.name}`;
    const spec = resource.spec as Record<string, unknown>;

    // Tool/Extension/ExtensionHandler entry
    if (
      (resource.kind === "Tool" ||
        resource.kind === "Extension" ||
        resource.kind === "ExtensionHandler") &&
      typeof spec.entry === "string"
    ) {
      paths.push({
        path: resolveRelativePath(spec.entry, bundleRoot),
        resource: resourceId,
        field: "spec.entry",
      });
    }

    // Connector custom entry
    if (
      resource.kind === "Connector" &&
      spec.type === "custom" &&
      typeof spec.entry === "string"
    ) {
      paths.push({
        path: resolveRelativePath(spec.entry, bundleRoot),
        resource: resourceId,
        field: "spec.entry",
      });
    }

    // Agent prompts.systemRef
    if (resource.kind === "Agent") {
      const prompts = spec.prompts as Record<string, unknown> | undefined;
      if (prompts && typeof prompts.systemRef === "string") {
        paths.push({
          path: resolveRelativePath(prompts.systemRef, bundleRoot),
          resource: resourceId,
          field: "spec.prompts.systemRef",
        });
      }
    }
  }

  return paths;
}

/**
 * Resolve relative path from bundle root
 */
function resolveRelativePath(relativePath: string, bundleRoot: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  // Remove leading ./ if present
  const cleanPath = relativePath.startsWith("./")
    ? relativePath.slice(2)
    : relativePath;
  return path.join(bundleRoot, cleanPath);
}

/**
 * Validate file existence
 */
async function validateFileExistence(
  resources: Resource[],
  bundleRoot: string
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const filePaths = extractFilePaths(resources, bundleRoot);

  for (const { path: filePath, resource, field } of filePaths) {
    const exists = await fileExists(filePath);
    if (!exists) {
      issues.push({
        code: "FILE_NOT_FOUND",
        message: `File not found: ${filePath}`,
        level: "error",
        resource,
        field,
        file: filePath,
      });
    }
  }

  return issues;
}

/**
 * Convert bundle errors to validation issues
 */
function convertBundleErrors(
  result: BundleLoadResult
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const err of result.errors) {
    const issue: ValidationIssue = {
      code: err.name.toUpperCase().replace("ERROR", "_ERROR"),
      message: err.message,
      level: "error",
    };

    // Propagate suggestion/helpUrl from BundleError
    if (err instanceof BundleError) {
      issue.suggestion = err.suggestion;
      issue.helpUrl = err.helpUrl;
    }

    // Handle ValidationError with level
    if (err instanceof ValidationError) {
      issue.level = err.level;
      issue.path = err.path;
      issue.resource = err.kind && err.resourceName
        ? `${err.kind}/${err.resourceName}`
        : undefined;
      issue.field = err.path;
    }

    // Handle ReferenceError
    if (err instanceof ReferenceError) {
      issue.code = "REFERENCE_ERROR";
      if (err.sourceKind && err.sourceName) {
        issue.resource = `${err.sourceKind}/${err.sourceName}`;
      }
    }

    // Handle ParseError
    if (err instanceof ParseError) {
      issue.code = "PARSE_ERROR";
      issue.file = err.source;
      issue.line = err.line;
    }

    if (issue.level === "warning") {
      warnings.push(issue);
    } else {
      errors.push(issue);
    }
  }

  return { errors, warnings };
}

/**
 * Execute validation
 */
async function executeValidation(
  bundlePath: string,
  options: ValidateOptions
): Promise<ValidateResult> {
  const absolutePath = path.resolve(process.cwd(), bundlePath);

  // Check if path exists
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    return {
      valid: false,
      errors: [
        {
          code: "PATH_NOT_FOUND",
          message: `Path not found: ${absolutePath}`,
          level: "error",
        },
      ],
      warnings: [],
      resourceCount: 0,
      sources: [],
    };
  }

  // Load bundle
  let result: BundleLoadResult;
  if (stat.isDirectory()) {
    result = await loadBundleFromDirectory(absolutePath);
  } else {
    result = await loadBundleFromFile(absolutePath);
  }

  // Convert bundle errors
  const { errors, warnings } = convertBundleErrors(result);

  // Additional file existence validation
  const bundleRoot = stat.isDirectory() ? absolutePath : path.dirname(absolutePath);
  const fileIssues = await validateFileExistence(result.resources, bundleRoot);
  errors.push(...fileIssues);

  // Determine validity
  let valid = errors.length === 0;
  if (options.strict && warnings.length > 0) {
    valid = false;
  }

  return {
    valid,
    errors,
    warnings,
    resourceCount: result.resources.length,
    sources: result.sources,
  };
}

/**
 * Format output as text
 */
function formatTextOutput(
  result: ValidateResult,
  bundlePath: string,
  options: ValidateOptions
): void {
  const c = chalk;

  console.log();
  console.log(c.bold(`Validating ${bundlePath}...`));
  console.log();

  // Summary of what was loaded
  if (result.resourceCount > 0) {
    info(`Found ${result.resourceCount} resources in ${result.sources.length} file(s)`);
  }
  console.log();

  // Group issues by type for cleaner output
  const schemaErrors = result.errors.filter(
    (e) => e.code === "VALIDATION_ERROR" || e.code.includes("REQUIRED")
  );
  const refErrors = result.errors.filter((e) => e.code === "REFERENCE_ERROR");
  const fileErrors = result.errors.filter((e) => e.code === "FILE_NOT_FOUND");
  const parseErrors = result.errors.filter((e) => e.code === "PARSE_ERROR");
  const otherErrors = result.errors.filter(
    (e) =>
      !["VALIDATION_ERROR", "REFERENCE_ERROR", "FILE_NOT_FOUND", "PARSE_ERROR"].includes(e.code) &&
      !e.code.includes("REQUIRED")
  );

  // Helper to print suggestion after error
  const printSuggestion = (issue: ValidationIssue): void => {
    if (issue.suggestion) {
      console.log(c.cyan(`    -> ${issue.suggestion}`));
    }
    if (issue.helpUrl) {
      console.log(c.dim(`    See: ${issue.helpUrl}`));
    }
  };

  // Schema validation
  if (schemaErrors.length === 0 && parseErrors.length === 0) {
    console.log(c.green("\u2713") + " Schema validation passed");
  } else {
    console.log(c.red("\u2717") + " Schema validation failed");
    for (const err of [...parseErrors, ...schemaErrors]) {
      const location = err.resource ? ` (${err.resource})` : "";
      console.log(c.red(`  - ${err.message}${location}`));
      printSuggestion(err);
    }
  }

  // Reference integrity
  if (refErrors.length === 0) {
    console.log(c.green("\u2713") + " Reference integrity passed");
  } else {
    console.log(c.red("\u2717") + " Reference integrity check failed");
    for (const err of refErrors) {
      const location = err.resource ? ` in ${err.resource}` : "";
      console.log(c.red(`  - ${err.message}${location}`));
      printSuggestion(err);
    }
  }

  // File existence
  if (fileErrors.length === 0) {
    console.log(c.green("\u2713") + " File existence check passed");
  } else {
    console.log(c.red("\u2717") + " File existence check failed");
    for (const err of fileErrors) {
      const location = err.resource ? ` (referenced in ${err.resource})` : "";
      console.log(c.red(`  - ${err.file}: File not found${location}`));
      printSuggestion(err);
    }
  }

  // Naming conventions (warnings)
  const namingWarnings = result.warnings.filter(
    (w) => w.message.includes("naming convention") || w.code === "NAMING_CONVENTION"
  );
  if (namingWarnings.length > 0) {
    console.log(c.yellow("\u26A0") + " Naming convention warning");
    for (const warn of namingWarnings) {
      const location = warn.resource ? ` - ${warn.resource}` : "";
      console.log(c.yellow(`  ${location}: ${warn.message}`));
    }
  }

  // Other warnings
  const otherWarnings = result.warnings.filter(
    (w) => !w.message.includes("naming convention") && w.code !== "NAMING_CONVENTION"
  );
  if (otherWarnings.length > 0) {
    for (const warn of otherWarnings) {
      console.log(c.yellow(`\u26A0 ${warn.message}`));
    }
  }

  // Other errors
  if (otherErrors.length > 0) {
    console.log(c.red("\u2717") + " Other errors");
    for (const err of otherErrors) {
      console.log(c.red(`  - ${err.message}`));
    }
  }

  // Summary
  console.log();
  const errorCount = result.errors.length;
  const warningCount = result.warnings.length;

  if (result.valid) {
    if (warningCount > 0) {
      success(`Validation passed with ${warningCount} warning(s)`);
    } else {
      success("Validation passed");
    }
  } else {
    const strictNote = options.strict && errorCount === 0
      ? " (strict mode: warnings treated as errors)"
      : "";
    logError(`Errors: ${errorCount}, Warnings: ${warningCount}${strictNote}`);
  }
  console.log();
}

/**
 * Format output as JSON
 */
function formatJsonOutput(result: ValidateResult): void {
  const output = {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    summary: {
      resourceCount: result.resourceCount,
      sourceCount: result.sources.length,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Format output as GitHub Actions annotations
 */
function formatGitHubOutput(result: ValidateResult): void {
  // Output errors
  for (const err of result.errors) {
    const file = err.file ?? "";
    const line = err.line ?? 1;
    const title = err.code;
    const message = err.message.replace(/\n/g, "%0A");
    console.log(`::error file=${file},line=${line},title=${title}::${message}`);
  }

  // Output warnings
  for (const warn of result.warnings) {
    const file = warn.file ?? "";
    const line = warn.line ?? 1;
    const title = warn.code;
    const message = warn.message.replace(/\n/g, "%0A");
    console.log(`::warning file=${file},line=${line},title=${title}::${message}`);
  }

  // Summary
  if (result.valid) {
    console.log(`::notice::Validation passed (${result.resourceCount} resources, ${result.warnings.length} warnings)`);
  } else {
    console.log(`::error::Validation failed (${result.errors.length} errors, ${result.warnings.length} warnings)`);
  }
}

/**
 * Execute the validate command
 */
async function executeValidateCommand(
  bundlePath: string,
  options: ValidateOptions
): Promise<void> {
  const spinner = ora();

  try {
    // Show spinner only for text format
    if (options.format === "text") {
      spinner.start("Validating Bundle configuration...");
    }

    // Run validation
    const result = await executeValidation(bundlePath, options);

    // Stop spinner
    if (options.format === "text") {
      spinner.stop();
    }

    // Output based on format
    switch (options.format) {
      case "json":
        formatJsonOutput(result);
        break;
      case "github":
        formatGitHubOutput(result);
        break;
      case "text":
      default:
        formatTextOutput(result, bundlePath, options);
        break;
    }

    // Set exit code
    if (!result.valid) {
      process.exitCode = 4; // VALIDATION_ERROR
    }
  } catch (err) {
    if (options.format === "text") {
      spinner.fail("Validation failed");
    }

    if (err instanceof Error) {
      if (options.format === "json") {
        console.log(
          JSON.stringify({
            valid: false,
            errors: [{ code: "INTERNAL_ERROR", message: err.message, level: "error" }],
            warnings: [],
          })
        );
      } else if (options.format === "github") {
        console.log(`::error::${err.message}`);
      } else {
        logError(err.message);
      }
    }

    process.exitCode = 4;
  }
}

/**
 * Create the validate command
 *
 * @returns Commander command for 'gdn validate'
 */
export function createValidateCommand(): Command {
  const command = new Command("validate")
    .description("Validate Bundle configuration")
    .addHelpText(
      "after",
      `
Examples:
  $ gdn validate                   Validate current directory
  $ gdn validate ./my-project      Validate specific path
  $ gdn validate --strict          Treat warnings as errors
  $ gdn validate --format json     Output as JSON
  $ gdn validate --format github   GitHub Actions annotations`
    )
    .argument("[path]", "Bundle path (file or directory)", ".")
    .addOption(
      new Option("--strict", "Treat warnings as errors").default(false)
    )
    .addOption(
      new Option("--fix", "Auto-fix fixable issues (placeholder)").default(false)
    )
    .addOption(
      new Option("--format <format>", "Output format")
        .choices(["text", "json", "github"])
        .default("text")
    )
    .action(async (bundlePath: string, options: Record<string, unknown>) => {
      const validateOptions: ValidateOptions = {
        strict: options.strict === true,
        fix: options.fix === true,
        format: (options.format as OutputFormat) ?? "text",
      };

      // Show fix placeholder message
      if (validateOptions.fix && validateOptions.format === "text") {
        warn("--fix option is not yet implemented");
      }

      await executeValidateCommand(bundlePath, validateOptions);
    });

  return command;
}

export default createValidateCommand;
