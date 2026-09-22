export const SPEC_VERSION = "0.1";

export { loadConfig, loadConfigSync, validateConfig } from "./config.ts";
export {
  GoondanConfigError, GoondanExecutionError, formatConfigIssues,
  isGoondanConfigError, isGoondanExecutionError,
} from "./errors.ts";
export type { ExecutionErrorDetail } from "./errors.ts";
export { jsonEqual, jsonText, sortIssues } from "./json.ts";
export { configSchema, unsupportedSchemaKeywords, validateSchema } from "./schema.ts";
export { parseConfigDocument } from "./yaml.ts";
export { mergeValues } from "./compose.ts";
export { defineExtension, defineTool } from "./extension.ts";
export { Goondan, createGoondan } from "./runtime.ts";
export { MemoryStore, StoreConflictError, StoreInputError } from "./store.ts";
export { JOURNAL_VERSION, JournalFoldError, fold } from "./fold.ts";
export { TemplateRenderer, TemplateRenderError } from "./template.ts";
export type * from "./types.ts";
