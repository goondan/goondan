/**
 * Instance command group
 *
 * Manages Swarm instances - list, inspect, delete, resume
 * @see /docs/specs/cli.md - Section 7 (gdn instance)
 * @see /docs/specs/workspace.md - Instance State Root
 */

import { Command } from "commander";
import { createListCommand } from "./list.js";
import { createInspectCommand } from "./inspect.js";
import { createDeleteCommand } from "./delete.js";
import { createResumeCommand } from "./resume.js";
import { createPauseCommand } from "./pause.js";
import { createTerminateCommand } from "./terminate.js";

/**
 * Create the main instance command group
 *
 * @returns Commander command for 'gdn instance'
 */
export function createInstanceCommand(): Command {
  const command = new Command("instance")
    .description("Manage Swarm instances")
    .addCommand(createListCommand())
    .addCommand(createInspectCommand())
    .addCommand(createPauseCommand())
    .addCommand(createResumeCommand())
    .addCommand(createTerminateCommand())
    .addCommand(createDeleteCommand());

  return command;
}

// Export individual command creators for testing
export {
  createListCommand,
  createInspectCommand,
  createPauseCommand,
  createResumeCommand,
  createTerminateCommand,
  createDeleteCommand,
};

// Export types
export type { ListOptions } from "./list.js";
export type { PauseOptions } from "./pause.js";
export type { ResumeOptions } from "./resume.js";
export type { TerminateOptions } from "./terminate.js";
export type { DeleteOptions } from "./delete.js";

// Export utils for reuse
export {
  getGoondanHomeSync,
  getGoondanHome,
  findInstancePath,
  readJsonlFile,
  countJsonlLines,
  formatDate,
  formatStatus,
  getInstanceInfo,
  getInstanceBasicInfo,
  isSwarmEventRecord,
  isAgentEventRecord,
  determineInstanceStatus,
  countTurns,
} from "./utils.js";
export type {
  SwarmEventRecord,
  AgentEventRecord,
  InstanceStatus,
  InstanceInfo,
} from "./utils.js";

export default createInstanceCommand;
