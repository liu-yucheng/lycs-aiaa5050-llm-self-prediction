// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The configuration files of one workspace.
 *
 * The workspace root holds three files. `.env` is private and holds the base URL and the API key of
 * each provider. `.env.example` is public and holds the same keys with placeholder values.
 * `models-to-use.env` is public and holds the model list of each provider. The plugin copies an
 * example file when a configuration file is absent, and it never writes an API key to a session
 * file.
 */

import path from "node:path";
import { writeFile } from "node:fs/promises";

import {
  ENV_API_KEY_PROPERTY,
  ENV_BASE_URL_PROPERTY,
  ENV_EDGE_HOST_PROPERTY,
  ENV_EXAMPLE_FILE_NAME,
  ENV_FILE_NAME,
  ENV_MODEL_PROPERTY,
  ENV_MODELS_PROPERTY,
  ENV_REASONING_PROPERTY,
  ENV_THINKING_PROPERTY,
  ENV_TOP_LOGPROBS_PROPERTY,
  MODELS_FILE_NAME,
} from "./constants.js";
import { packagedPath, pathExists, readTextFile } from "./files.js";

/** The override values of one provider section. */
export interface ProviderEnvironment {
  /** The base URL of the endpoint. */
  readonly baseUrl?: string;
  /** The single model of the provider. */
  readonly model?: string;
  /** The model list of the provider. */
  readonly models?: readonly string[];
  /** The API key of the provider. */
  readonly apiKey?: string;
  /** The count of the served table entries. */
  readonly topLogprobsCount?: number;
  /** The edge host that carries the request to the endpoint. */
  readonly edgeHost?: string;
  /** The thinking switch of the endpoint. */
  readonly thinking?: string;
  /** The reasoning switch of the endpoint. */
  readonly reasoning?: string;
}

/** The state of the environment file of one directory. */
export interface EnvironmentFileState {
  readonly directory: string;
  readonly filePath?: string;
  readonly examplePath?: string;
  readonly migratedFrom?: string;
  readonly created: boolean;
}

/**
 * Report whether one value is absent or an unfilled placeholder.
 *
 * A placeholder starts with `<` and ends with `>`, as in `<Your API key, not mine.>`.
 *
 * @param value - the value to test.
 * @returns true when the value is empty or a placeholder.
 */
export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  return trimmed.startsWith("<") && trimmed.endsWith(">");
}

/**
 * Parse the text of one environment file.
 *
 * The parser reads one `key=value` line at a time. It ignores a blank line and a line that starts
 * with `#`. It accepts an `export ` prefix and strips one pair of matching quotes.
 *
 * @param text - the file text.
 * @returns the parsed values in file order.
 */
export function parseEnvironmentText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = body.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = body.slice(0, separator).trim();
    if (key === "") {
      continue;
    }
    values[key] = unquote(body.slice(separator + 1).trim());
  }
  return values;
}

/**
 * Remove one pair of matching quotes around one value.
 *
 * @param value - the raw value.
 * @returns the value without the quotes.
 */
function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Read one environment file.
 *
 * @param filePath - the path of the file.
 * @returns the parsed values, or an empty record when the file is absent.
 */
export async function readEnvironmentFile(
  filePath: string,
): Promise<Record<string, string>> {
  if (!(await pathExists(filePath))) {
    return {};
  }
  return parseEnvironmentText(await readTextFile(filePath));
}

/**
 * Group the parsed values by provider section.
 *
 * A key has the form `<prefix>.<property>`. The builder accepts the properties `base_url`,
 * `model_to_use`, `api_key`, `top_logprobs`, and `thinking`. It ignores any other property and any
 * key without a dot.
 *
 * @param values - the parsed values of one environment file.
 * @returns the section values in file order.
 */
export function buildProviderEnvironments(
  values: Readonly<Record<string, string>>,
): Map<string, ProviderEnvironment> {
  const environments = new Map<string, ProviderEnvironment>();
  for (const [key, value] of Object.entries(values)) {
    const separator = key.indexOf(".");
    if (separator <= 0) {
      continue;
    }
    const prefix = key.slice(0, separator).trim().toLowerCase();
    const property = key.slice(separator + 1).trim().toLowerCase();
    if (prefix === "") {
      continue;
    }
    const current = environments.get(prefix) ?? {};
    if (property === ENV_BASE_URL_PROPERTY) {
      environments.set(prefix, { ...current, baseUrl: value });
    } else if (property === ENV_MODEL_PROPERTY) {
      environments.set(prefix, { ...current, model: value });
    } else if (property === ENV_MODELS_PROPERTY) {
      const models = value
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model !== "");
      if (models.length > 0) {
        environments.set(prefix, { ...current, models });
      }
    } else if (property === ENV_API_KEY_PROPERTY) {
      environments.set(prefix, { ...current, apiKey: value });
    } else if (property === ENV_TOP_LOGPROBS_PROPERTY) {
      const count = Number.parseInt(value.trim(), 10);
      if (Number.isInteger(count) && count >= 1 && count <= 64) {
        environments.set(prefix, { ...current, topLogprobsCount: count });
      }
    } else if (property === ENV_EDGE_HOST_PROPERTY) {
      const edgeHost = value.trim().toLowerCase();
      if (edgeHost !== "") {
        environments.set(prefix, { ...current, edgeHost });
      }
    } else if (property === ENV_THINKING_PROPERTY) {
      const thinking = value.trim().toLowerCase();
      if (thinking !== "") {
        environments.set(prefix, { ...current, thinking });
      }
    } else if (property === ENV_REASONING_PROPERTY) {
      const reasoning = value.trim().toLowerCase();
      if (reasoning !== "") {
        environments.set(prefix, { ...current, reasoning });
      }
    }
  }
  return environments;
}

/**
 * Name the environment key of one provider property.
 *
 * @param prefix - the provider section name.
 * @param property - the property name.
 * @returns the key, as in `deepseek.api_key`.
 */
export function describeEnvironmentKey(prefix: string, property: string): string {
  return `${prefix}.${property}`;
}

/**
 * Merge two groups of provider sections.
 *
 * The overlay group wins for each property that it holds. The base group keeps every other
 * property.
 *
 * @param base - the base sections.
 * @param overlay - the sections that win.
 * @returns the merged sections.
 */
export function mergeProviderEnvironments(
  base: ReadonlyMap<string, ProviderEnvironment>,
  overlay: ReadonlyMap<string, ProviderEnvironment>,
): Map<string, ProviderEnvironment> {
  const merged = new Map<string, ProviderEnvironment>(base);
  for (const [prefix, section] of overlay) {
    const current = merged.get(prefix) ?? {};
    merged.set(prefix, {
      ...current,
      ...(section.baseUrl === undefined ? {} : { baseUrl: section.baseUrl }),
      ...(section.model === undefined ? {} : { model: section.model }),
      ...(section.models === undefined ? {} : { models: section.models }),
      ...(section.apiKey === undefined ? {} : { apiKey: section.apiKey }),
      ...(section.topLogprobsCount === undefined ? {} : { topLogprobsCount: section.topLogprobsCount }),
      ...(section.edgeHost === undefined ? {} : { edgeHost: section.edgeHost }),
      ...(section.thinking === undefined ? {} : { thinking: section.thinking }),
      ...(section.reasoning === undefined ? {} : { reasoning: section.reasoning }),
    });
  }
  return merged;
}

/** The state of the configuration of one workspace. */
export interface ConfigurationState {
  /** The state of the private environment file. */
  readonly environment: EnvironmentFileState;
  /** The path of the models file. */
  readonly modelsFilePath?: string;
  /** True when this command created the models file. */
  readonly modelsFileCreated?: boolean;
}

/** The configuration of one workspace. */
export interface WorkspaceConfiguration {
  /** The state of each configuration file. */
  readonly state: ConfigurationState;
  /** The merged provider sections. */
  readonly environments: Map<string, ProviderEnvironment>;
  /** The problems that the reader found. */
  readonly problems: readonly string[];
}

/**
 * Ensure the private environment file of one workspace.
 *
 * The function returns the existing file when it is present. When the file is absent, the function
 * copies the example file of the workspace, or the packaged example file, and reports that it
 * created the file. The created file holds placeholder values. A file of the older `inputs/` layout
 * moves to the workspace root.
 *
 * @param workspace - the workspace directory.
 * @returns the state of the environment file.
 */
export async function ensureEnvironmentFile(
  workspace: string,
): Promise<EnvironmentFileState> {
  const directory = workspace;
  const filePath = path.join(directory, ENV_FILE_NAME);
  const examplePath = path.join(directory, ENV_EXAMPLE_FILE_NAME);
  if (await pathExists(filePath)) {
    const hasExample = await pathExists(examplePath);
    return {
      directory,
      filePath,
      examplePath: hasExample ? examplePath : undefined,
      created: false,
    };
  }
  const legacyPath = path.join(workspace, "inputs", ENV_FILE_NAME);
  if (await pathExists(legacyPath)) {
    const text = await readTextFile(legacyPath);
    const body = text.endsWith("\n") ? text : `${text}\n`;
    await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    return { directory, filePath, created: false, migratedFrom: legacyPath };
  }
  const source = (await pathExists(examplePath))
    ? examplePath
    : packagedPath(ENV_EXAMPLE_FILE_NAME);
  if (await pathExists(source)) {
    return copyExample(directory, source);
  }
  return { directory, created: false };
}

/**
 * Ensure the models file of one workspace.
 *
 * The function keeps an existing file. When the file is absent, the function copies the packaged
 * file and reports that it created the file. A copy keeps the model lists of the package.
 *
 * @param workspace - the workspace directory.
 * @returns the path of the file, and the created flag.
 */
export async function ensureModelsFile(
  workspace: string,
): Promise<{ readonly filePath?: string; readonly created: boolean }> {
  const filePath = path.join(workspace, MODELS_FILE_NAME);
  if (await pathExists(filePath)) {
    return { filePath, created: false };
  }
  const packaged = packagedPath(MODELS_FILE_NAME);
  if (!(await pathExists(packaged))) {
    return { created: false };
  }
  const text = await readTextFile(packaged);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await writeFile(filePath, body, { encoding: "utf8" });
  return { filePath, created: true };
}

/**
 * Read the configuration of one workspace.
 *
 * The reader takes the base URL, the API key, and the switches from `.env`. It takes the model
 * lists from `models-to-use.env`. The models file wins for a model list, so a workspace can change
 * the tested models without a change of the private file.
 *
 * @param workspace - the workspace directory.
 * @returns the configuration, with one problem line for each defect.
 */
export async function readConfiguration(workspace: string): Promise<WorkspaceConfiguration> {
  const environment = await ensureEnvironmentFile(workspace);
  const models = await ensureModelsFile(workspace);
  const environmentValues =
    environment.filePath === undefined ? {} : await readEnvironmentFile(environment.filePath);
  const modelsValues = models.filePath === undefined ? {} : await readEnvironmentFile(models.filePath);
  const problems: string[] = [];
  if (environment.filePath === undefined) {
    problems.push(`The workspace holds no ${ENV_FILE_NAME} file and no example file to copy.`);
  }
  if (models.filePath === undefined) {
    problems.push(`The workspace holds no ${MODELS_FILE_NAME} file.`);
  }
  const baseSections = buildProviderEnvironments(environmentValues);
  const modelSections = buildProviderEnvironments(modelsValues);
  return {
    state: {
      environment,
      modelsFilePath: models.filePath,
      modelsFileCreated: models.created,
    },
    environments: mergeProviderEnvironments(baseSections, modelSections),
    problems,
  };
}

/**
 * Copy one example file to the private environment file.
 *
 * The copy keeps the placeholders. The file mode is owner read and write only.
 *
 * @param directory - the directory that receives the file.
 * @param examplePath - the example file to copy.
 * @returns the state of the created file.
 */
async function copyExample(
  directory: string,
  examplePath: string,
): Promise<EnvironmentFileState> {
  const filePath = path.join(directory, ENV_FILE_NAME);
  const text = await readTextFile(examplePath);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
  return { directory, filePath, examplePath, created: true };
}
