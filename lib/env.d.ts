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
export declare function isPlaceholderValue(value: string): boolean;
/**
 * Parse the text of one environment file.
 *
 * The parser reads one `key=value` line at a time. It ignores a blank line and a line that starts
 * with `#`. It accepts an `export ` prefix and strips one pair of matching quotes.
 *
 * @param text - the file text.
 * @returns the parsed values in file order.
 */
export declare function parseEnvironmentText(text: string): Record<string, string>;
/**
 * Read one environment file.
 *
 * @param filePath - the path of the file.
 * @returns the parsed values, or an empty record when the file is absent.
 */
export declare function readEnvironmentFile(filePath: string): Promise<Record<string, string>>;
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
export declare function buildProviderEnvironments(values: Readonly<Record<string, string>>): Map<string, ProviderEnvironment>;
/** The result of one read of the private environment file. */
export interface PrivateEnvironmentResult {
    /** The accepted section values in file order. */
    readonly environments: Map<string, ProviderEnvironment>;
    /** The keys that hold a property outside the private set, as in `huggingface.edge_host`. */
    readonly rejectedKeys: readonly string[];
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
export declare function buildPrivateProviderEnvironments(values: Readonly<Record<string, string>>): PrivateEnvironmentResult;
/**
 * Name the environment key of one provider property.
 *
 * @param prefix - the provider section name.
 * @param property - the property name.
 * @returns the key, as in `deepseek.api_key`.
 */
export declare function describeEnvironmentKey(prefix: string, property: string): string;
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
export declare function mergeProviderEnvironments(base: ReadonlyMap<string, ProviderEnvironment>, overlay: ReadonlyMap<string, ProviderEnvironment>): Map<string, ProviderEnvironment>;
/** The state of the configuration of one workspace. */
export interface ConfigurationState {
    /** The state of the private environment file. */
    readonly environment: EnvironmentFileState;
    /** The path of the public configuration file. */
    readonly configFilePath?: string;
    /** True when this command created the public configuration file. */
    readonly configFileCreated?: boolean;
    /** The path of the legacy configuration file that the command copied. */
    readonly configFileMigratedFrom?: string;
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
export declare function ensureEnvironmentFile(workspace: string): Promise<EnvironmentFileState>;
/** The state of the public configuration file of one workspace. */
export interface ConfigFileState {
    /** The path of the configuration file. */
    readonly filePath?: string;
    /** True when this command created the configuration file. */
    readonly created: boolean;
    /** The path of the legacy file that the command copied. */
    readonly migratedFrom?: string;
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
export declare function ensureConfigFile(workspace: string): Promise<ConfigFileState>;
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
export declare function readConfiguration(workspace: string): Promise<WorkspaceConfiguration>;
