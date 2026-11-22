import type { ToolDefinition, ToolsService } from "./dsh.js";
import type { ExperimentService, RunRequest } from "./experiment.js";
/**
 * Register every tool of the plugin.
 *
 * @param tools - the host tool registry.
 * @param service - the experiment service.
 * @returns one disposer for each registered tool.
 */
export declare function registerTools(tools: ToolsService, service: ExperimentService): Array<() => void>;
/**
 * Create the definition of each tool.
 *
 * @param service - the experiment service.
 * @returns the tool definitions in registration order.
 */
export declare function createToolDefinitions(service: ExperimentService): ToolDefinition[];
/**
 * Build the help text.
 *
 * @returns the help text in Markdown.
 */
export declare function buildHelpText(): string;
/**
 * Build one run request from the tool arguments.
 *
 * @param args - the tool arguments.
 * @returns the run request.
 */
export declare function buildRunRequest(args: unknown): RunRequest;
