/**
 * Package command group
 *
 * Manages Bundle packages - install, add, remove, publish, etc.
 * @see /docs/specs/cli.md - Section 6 (gdn package)
 * @see /docs/specs/bundle_package.md
 */

import { Command } from "commander";
import { createInstallCommand } from "./install.js";
import { createAddCommand } from "./add.js";
import { createRemoveCommand } from "./remove.js";
import { createUpdateCommand } from "./update.js";
import { createListCommand } from "./list.js";
import { createPublishCommand } from "./publish.js";
import { createLoginCommand } from "./login.js";
import { createLogoutCommand } from "./logout.js";
import { createPackCommand } from "./pack.js";
import { createInfoCommand } from "./info.js";
import { createCacheCommand } from "./cache.js";
import { createUnpublishCommand } from "./unpublish.js";
import { createDeprecateCommand } from "./deprecate.js";

/**
 * Create the main package command group
 *
 * @returns Commander command for 'gdn package'
 */
export function createPackageCommand(): Command {
  const command = new Command("package")
    .description("Manage Bundle packages")
    .addCommand(createInstallCommand())
    .addCommand(createAddCommand())
    .addCommand(createRemoveCommand())
    .addCommand(createUpdateCommand())
    .addCommand(createListCommand())
    .addCommand(createPublishCommand())
    .addCommand(createUnpublishCommand())
    .addCommand(createDeprecateCommand())
    .addCommand(createLoginCommand())
    .addCommand(createLogoutCommand())
    .addCommand(createPackCommand())
    .addCommand(createInfoCommand())
    .addCommand(createCacheCommand());

  return command;
}

// Export individual command creators for testing
export {
  createInstallCommand,
  createAddCommand,
  createRemoveCommand,
  createUpdateCommand,
  createListCommand,
  createPublishCommand,
  createUnpublishCommand,
  createDeprecateCommand,
  createLoginCommand,
  createLogoutCommand,
  createPackCommand,
  createInfoCommand,
  createCacheCommand,
};

export default createPackageCommand;
