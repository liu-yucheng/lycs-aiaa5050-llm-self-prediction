// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * The configuration files of one workspace.
 *
 * The workspace root holds three files. `.env` is private and holds the optional repository URL,
 * the base URL, and the API key of each provider. `.env.example` is public and holds the same keys
 * with placeholder values. `configs.env` is public and holds every other provider setting, such as
 * the model list and the switches. The reader enforces the split: a property outside the private
 * set in `.env` is a problem, and the plugin applies only the configuration file value. The plugin
 * copies an example file when a configuration file is absent, and it never writes an API key to a
 * session file.
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { CONFIG_FILE_NAME, ENV_API_KEY_PROPERTY, ENV_BASE_URL_PROPERTY, ENV_EDGE_HOST_PROPERTY, ENV_EXAMPLE_FILE_NAME, ENV_FILE_NAME, ENV_MODEL_PROPERTY, ENV_MODELS_PROPERTY, ENV_REASONING_PROPERTY, ENV_THINKING_PROPERTY, ENV_TOP_LOGPROBS_PROPERTY, LEGACY_CONFIG_FILE_NAME, PRIVATE_ENVIRONMENT_PROPERTIES, } from "./constants.js";
import { packagedPath, pathExists, readTextFile } from "./files.js";
/**
 * Report whether one value is absent or an unfilled placeholder.
 *
 * A placeholder starts with `<` and ends with `>`, as in `<Your API key, not mine.>`.
 *
 * @param value - the value to test.
 * @returns true when the value is empty or a placeholder.
 */
export function isPlaceholderValue(value) {
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
export function parseEnvironmentText(text) {
    const values = {};
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
function unquote(value) {
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
export async function readEnvironmentFile(filePath) {
    if (!(await pathExists(filePath))) {
        return {};
    }
    return parseEnvironmentText(await readTextFile(filePath));
}
/**
 * Split one environment key into its provider prefix and its property.
 *
 * A key has the form `<prefix>.<property>`. The function rejects a key without a dot and a key with
 * an empty prefix.
 *
 * @param key - the key of one environment file line.
 * @returns the two parts, or undefined when the key is invalid.
 */
function splitEnvironmentKey(key) {
    const separator = key.indexOf(".");
    if (separator <= 0) {
        return undefined;
    }
    const prefix = key.slice(0, separator).trim().toLowerCase();
    const property = key.slice(separator + 1).trim().toLowerCase();
    if (prefix === "" || property === "") {
        return undefined;
    }
    return { prefix, property };
}
/**
 * Apply one provider property to one group of sections.
 *
 * The function accepts `base_url`, `model_to_use`, `models_to_use`, `api_key`, `top_logprobs`,
 * `edge_host`, `thinking`, and `reasoning`. It ignores any other property, because the private
 * environment file also holds an optional `repo_url` that the plugin does not use.
 *
 * @param environments - the sections to change.
 * @param prefix - the provider section name.
 * @param property - the property name in lower case.
 * @param value - the property value.
 */
function applyProviderProperty(environments, prefix, property, value) {
    const current = environments.get(prefix) ?? {};
    if (property === ENV_BASE_URL_PROPERTY) {
        environments.set(prefix, { ...current, baseUrl: value });
    }
    else if (property === ENV_MODEL_PROPERTY) {
        environments.set(prefix, { ...current, model: value });
    }
    else if (property === ENV_MODELS_PROPERTY) {
        const models = value
            .split(",")
            .map((model) => model.trim())
            .filter((model) => model !== "");
        if (models.length > 0) {
            environments.set(prefix, { ...current, models });
        }
    }
    else if (property === ENV_API_KEY_PROPERTY) {
        environments.set(prefix, { ...current, apiKey: value });
    }
    else if (property === ENV_TOP_LOGPROBS_PROPERTY) {
        const count = Number.parseInt(value.trim(), 10);
        if (Number.isInteger(count) && count >= 1 && count <= 64) {
            environments.set(prefix, { ...current, topLogprobsCount: count });
        }
    }
    else if (property === ENV_EDGE_HOST_PROPERTY) {
        const edgeHost = value.trim().toLowerCase();
        if (edgeHost !== "") {
            environments.set(prefix, { ...current, edgeHost });
        }
    }
    else if (property === ENV_THINKING_PROPERTY) {
        const thinking = value.trim().toLowerCase();
        if (thinking !== "") {
            environments.set(prefix, { ...current, thinking });
        }
    }
    else if (property === ENV_REASONING_PROPERTY) {
        const reasoning = value.trim().toLowerCase();
        if (reasoning !== "") {
            environments.set(prefix, { ...current, reasoning });
        }
    }
}
/**
 * Group the parsed values of one configuration file by provider section.
 *
 * A key has the form `<prefix>.<property>`. The builder accepts `base_url`, `model_to_use`,
 * `models_to_use`, `api_key`, `top_logprobs`, `edge_host`, `thinking`, and `reasoning`. It ignores
 * any other property and any key without a dot.
 *
 * @param values - the parsed values of one environment file.
 * @returns the section values in file order.
 */
export function buildProviderEnvironments(values) {
    const environments = new Map();
    for (const [key, value] of Object.entries(values)) {
        const parsed = splitEnvironmentKey(key);
        if (parsed === undefined) {
            continue;
        }
        applyProviderProperty(environments, parsed.prefix, parsed.property, value);
    }
    return environments;
}
/**
 * Group the parsed values of the private environment file by provider section.
 *
 * The builder accepts only `repo_url`, `base_url`, and `api_key`. It accepts `repo_url` without a
 * use, because the plugin does not call one repository. A key outside the private set is a problem:
 * the builder rejects the key and reports it.
 *
 * @param values - the parsed values of the private environment file.
 * @returns the accepted section values and the rejected keys.
 */
export function buildPrivateProviderEnvironments(values) {
    const environments = new Map();
    const rejectedKeys = [];
    const accepted = new Set(PRIVATE_ENVIRONMENT_PROPERTIES);
    for (const [key, value] of Object.entries(values)) {
        const parsed = splitEnvironmentKey(key);
        if (parsed === undefined) {
            continue;
        }
        if (!accepted.has(parsed.property)) {
            rejectedKeys.push(describeEnvironmentKey(parsed.prefix, parsed.property));
            continue;
        }
        applyProviderProperty(environments, parsed.prefix, parsed.property, value);
    }
    return { environments, rejectedKeys };
}
/**
 * Describe the private property list for one problem line.
 *
 * @returns the property names, as in `repo_url, base_url, and api_key`.
 */
function describePrivateProperties() {
    const names = [...PRIVATE_ENVIRONMENT_PROPERTIES];
    if (names.length === 1) {
        return names[0] ?? "";
    }
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1] ?? ""}`;
}
/**
 * Name the environment key of one provider property.
 *
 * @param prefix - the provider section name.
 * @param property - the property name.
 * @returns the key, as in `deepseek.api_key`.
 */
export function describeEnvironmentKey(prefix, property) {
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
export function mergeProviderEnvironments(base, overlay) {
    const merged = new Map(base);
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
export async function ensureEnvironmentFile(workspace) {
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
 * Ensure the public configuration file of one workspace.
 *
 * The function keeps an existing file. When the file is absent and the older `models-to-use.env`
 * file is present, the function copies the older file and keeps it in place. When both files are
 * absent, the function copies the packaged file and reports that it created the file. A copy keeps
 * the provider settings of the source file.
 *
 * @param workspace - the workspace directory.
 * @returns the path of the file, the created flag, and the copy source.
 */
export async function ensureConfigFile(workspace) {
    const filePath = path.join(workspace, CONFIG_FILE_NAME);
    if (await pathExists(filePath)) {
        return { filePath, created: false };
    }
    const legacyPath = path.join(workspace, LEGACY_CONFIG_FILE_NAME);
    if (await pathExists(legacyPath)) {
        const text = await readTextFile(legacyPath);
        const body = text.endsWith("\n") ? text : `${text}\n`;
        await writeFile(filePath, body, { encoding: "utf8" });
        return { filePath, created: true, migratedFrom: legacyPath };
    }
    const packaged = packagedPath(CONFIG_FILE_NAME);
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
 * The reader takes the optional repository URL, the base URL, and the API key from `.env`. It takes
 * the model lists and the switches from `configs.env`. A private property outside the private set
 * is a problem, and the reader does not apply it. The configuration file wins for a property that
 * both files hold, so a workspace can change the tested models without a change of the private
 * file.
 *
 * @param workspace - the workspace directory.
 * @returns the configuration, with one problem line for each defect.
 */
export async function readConfiguration(workspace) {
    const environment = await ensureEnvironmentFile(workspace);
    const configFile = await ensureConfigFile(workspace);
    const environmentValues = environment.filePath === undefined ? {} : await readEnvironmentFile(environment.filePath);
    const configValues = configFile.filePath === undefined ? {} : await readEnvironmentFile(configFile.filePath);
    const problems = [];
    if (environment.filePath === undefined) {
        problems.push(`The workspace holds no ${ENV_FILE_NAME} file and no example file to copy.`);
    }
    if (configFile.filePath === undefined) {
        problems.push(`The workspace holds no ${CONFIG_FILE_NAME} file.`);
    }
    const privateRead = buildPrivateProviderEnvironments(environmentValues);
    for (const key of privateRead.rejectedKeys) {
        problems.push(`The ${ENV_FILE_NAME} file holds ${key}. The ${ENV_FILE_NAME} file accepts only ` +
            `${describePrivateProperties()}. Move ${key} to ${CONFIG_FILE_NAME}.`);
    }
    const configSections = buildProviderEnvironments(configValues);
    return {
        state: {
            environment,
            configFilePath: configFile.filePath,
            configFileCreated: configFile.created,
            configFileMigratedFrom: configFile.migratedFrom,
        },
        environments: mergeProviderEnvironments(privateRead.environments, configSections),
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
async function copyExample(directory, examplePath) {
    const filePath = path.join(directory, ENV_FILE_NAME);
    const text = await readTextFile(examplePath);
    const body = text.endsWith("\n") ? text : `${text}\n`;
    await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    return { directory, filePath, examplePath, created: true };
}
