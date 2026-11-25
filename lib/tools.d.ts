import type { ExperimentService } from "./experiment.js";
import type { ToolDefinition, ToolsService } from "./dsh.js";
/**
 * Build the help text of the plugin.
 *
 * @returns the Markdown help text.
 */
export declare function buildHelpText(): string;
/**
 * Create the tool definitions of the plugin.
 *
 * @param service - the experiment service.
 * @returns the definitions.
 */
export declare function createToolDefinitions(service: ExperimentService): ToolDefinition[];
/**
 * Register each tool of the plugin.
 *
 * @param tools - the host tool registry.
 * @param service - the experiment service.
 * @returns one disposer for each registration.
 */
export declare function registerTools(tools: ToolsService, service: ExperimentService): (() => void)[];
