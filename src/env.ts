// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The private environment file and the public example file.
 *
 * The private file holds one section for each provider. A section has three properties: the base
 * URL, the API key, and the model name. The example file ships with the plugin and holds
 * placeholder values. The plugin copies the example to the private file when the private file is
 * absent. It never writes an API key to a session file.
 */

import path from "node:path";
import { writeFile } from "node:fs/promises";

import {
  ENV_API_KEY_PROPERTY,
  ENV_BASE_URL_PROPERTY,
  ENV_EXAMPLE_FILE_NAME,
  ENV_FILE_NAME,
  ENV_MODEL_PROPERTY,
  ENV_MODELS_PROPERTY,
  ENV_REASONING_PROPERTY,
  ENV_THINKING_PROPERTY,
  ENV_TOP_LOGPROBS_PROPERTY,
  INPUTS_DIRECTORY_NAME,
} from "./constants.js";
import {
  ensureDirectory,
  packagedPath,
  pathExists,
  readTextFile,
  resolveInputsDirectory,
} from "./files.js";

/** The override values of one provider section. */
export interface ProviderEnvironment {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly models?: readonly string[];
  readonly apiKey?: string;
  readonly topLogprobsCount?: number;
  readonly thinking?: string;
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
 * Ensure the private environment file of one directory.
 *
 * The function returns the existing file when it is present. When the file is absent, the function
 * copies the example file of the directory, or the packaged example file, and reports that it
 * created the file. The created file holds placeholder values.
 *
 * @param directory - the directory that holds the experiment.
 * @returns the state of the environment file.
 */
export async function ensureEnvironmentFile(
  workspace: string,
): Promise<EnvironmentFileState> {
  const directory = resolveInputsDirectory(workspace);
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
  const legacyPath = path.join(workspace, ENV_FILE_NAME);
  if (await pathExists(legacyPath)) {
    await ensureDirectory(directory);
    const text = await readTextFile(legacyPath);
    const body = text.endsWith("\n") ? text : `${text}\n`;
    await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    return { directory, filePath, created: false, migratedFrom: legacyPath };
  }
  if (await pathExists(examplePath)) {
    await ensureDirectory(directory);
    return copyExample(directory, examplePath);
  }
  const packagedExample = packagedPath(path.join(INPUTS_DIRECTORY_NAME, ENV_EXAMPLE_FILE_NAME));
  if (await pathExists(packagedExample)) {
    await ensureDirectory(directory);
    return copyExample(directory, packagedExample);
  }
  return { directory, created: false };
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
