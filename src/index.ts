// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The host entry of the next-token self-prediction plugin.
 *
 * The plugin registers five tools and no runtime command. The configuration is read defensively,
 * so a host that supplies no configuration value still loads the plugin.
 */

import { DEFAULT_MAX_CONCURRENCY, PLUGIN_NAME } from "./constants.js";
import type { PluginContext, WorkingDirectoryService } from "./dsh.js";
import { isRecord } from "./errors.js";
import { ExperimentService } from "./experiment.js";
import { registerTools } from "./tools.js";

/** The plugin name. The host uses it in the log and in the tool scope. */
export const name: string = PLUGIN_NAME;

/** The host services that the plugin uses. */
export const inject: readonly string[] = ["tools", "workingDirectory"];

/**
 * Apply the plugin to one host context.
 *
 * @param ctx - the host plugin context.
 * @param config - the configuration row of the bundle patch.
 */
export function apply(ctx: PluginContext, config?: unknown): void {
  const settings = isRecord(config) ? config : {};
  const outputRoot = readStringSetting(settings["outputRoot"], "");
  const maxConcurrency = readIntegerSetting(
    settings["maxConcurrency"],
    DEFAULT_MAX_CONCURRENCY,
    1,
    16,
  );
  const directoryService =
    ctx.workingDirectory ?? ctx.get<WorkingDirectoryService>("workingDirectory");
  const service = new ExperimentService({
    resolveWorkspace: async (agent, signal): Promise<string> => {
      if (directoryService !== undefined && agent !== undefined) {
        return directoryService.ensure(agent, signal);
      }
      return process.cwd();
    },
    outputRoot: (): string => outputRoot,
    logger: ctx.logger,
    defaultMaxConcurrency: maxConcurrency,
  });
  ctx.effect(() => {
    const disposers = registerTools(ctx.tools, service);
    return (): void => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, "llm-self-prediction tools");
  ctx.logger?.info(
    `${PLUGIN_NAME}: the plugin is ready with output root "${outputRoot || ".outputs"}".`,
  );
}

/**
 * Read one string setting.
 *
 * @param value - the raw setting value.
 * @param fallback - the value of an absent or invalid setting.
 * @returns the setting value.
 */
function readStringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Read one integer setting inside a range.
 *
 * @param value - the raw setting value.
 * @param fallback - the value of an absent or invalid setting.
 * @param minimum - the smallest accepted value.
 * @param maximum - the largest accepted value.
 * @returns the setting value.
 */
function readIntegerSetting(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
