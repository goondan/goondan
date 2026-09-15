import { type ExtensionDefinition, type Tool } from "./types.ts";

export function defineExtension<T extends ExtensionDefinition>(definition: T): T { return definition; }
export function defineTool<T extends Tool>(tool: T): T { return tool; }
