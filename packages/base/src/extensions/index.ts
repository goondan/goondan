export {
  register as registerLoggingExtension,
  registerLoggingExtension as createLoggingExtension,
} from './logging.js';
export type { LoggingExtensionConfig } from './logging.js';

export {
  register as registerCompactionExtension,
  registerCompactionExtension as createCompactionExtension,
} from './compaction.js';
export type { CompactionExtensionConfig } from './compaction.js';

export {
  register as registerToolSearchExtension,
  registerToolSearchExtension as createToolSearchExtension,
} from './tool-search.js';
export type { ToolSearchExtensionConfig } from './tool-search.js';
