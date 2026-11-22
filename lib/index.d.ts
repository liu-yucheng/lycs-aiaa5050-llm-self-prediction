import type { PluginContext } from "./dsh.js";
/** The plugin name. The host uses it in the log and in the tool scope. */
export declare const name: string;
/** The host services that the plugin uses. */
export declare const inject: readonly string[];
/**
 * Apply the plugin to one host context.
 *
 * @param ctx - the host plugin context.
 * @param config - the configuration row of the bundle patch.
 */
export declare function apply(ctx: PluginContext, config?: unknown): void;
