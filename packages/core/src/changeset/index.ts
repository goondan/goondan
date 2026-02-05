/**
 * Changeset 시스템
 * @see /docs/specs/changeset.md
 */

// Types
export type {
  SwarmBundleRef,
  ParsedSwarmBundleRef,
  OpenChangesetInput,
  OpenChangesetResult,
  OpenChangesetHint,
  CommitChangesetInput,
  CommitChangesetResult,
  CommitSummary,
  CommitError,
  ChangesetPolicy,
  PolicyValidationResult,
  GitStatusCode,
  GitStatusEntry,
  SwarmBundleManager,
  SwarmBundleApi,
  RevisionChangedEvent,
  ChangesetEventRecord,
} from './types.js';

// Type utilities
export {
  parseSwarmBundleRef,
  formatSwarmBundleRef,
} from './types.js';

// Glob
export {
  matchGlob,
  matchAnyPattern,
} from './glob.js';

// Policy
export {
  validateChangesetPolicy,
} from './policy.js';

// Git
export {
  execGit,
  getHeadCommitSha,
  isGitRepository,
  parseGitStatus,
  categorizeChangedFiles,
  createWorktree,
  removeWorktree,
} from './git.js';

// Manager
export {
  SwarmBundleManagerImpl,
} from './manager.js';
export type { SwarmBundleManagerOptions } from './manager.js';

// API
export {
  createSwarmBundleApi,
} from './api.js';
