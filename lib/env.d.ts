/** The override values of one provider section. */
export interface ProviderEnvironment {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly models?: readonly string[];
    readonly apiKey?: string;
    readonly topLogprobsCount?: number;
    readonly edgeHost?: string;
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
 * Group the parsed values by provider section.
 *
 * A key has the form `<prefix>.<property>`. The builder accepts the properties `base_url`,
 * `model_to_use`, `api_key`, `top_logprobs`, and `thinking`. It ignores any other property and any
 * key without a dot.
 *
 * @param values - the parsed values of one environment file.
 * @returns the section values in file order.
 */
export declare function buildProviderEnvironments(values: Readonly<Record<string, string>>): Map<string, ProviderEnvironment>;
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
export declare function ensureEnvironmentFile(workspace: string): Promise<EnvironmentFileState>;
/**
 * Ensure the models file of one workspace.
 *
 * The function keeps an existing file. When the file is absent, the function copies the packaged
 * file and reports that it created the file. A copy keeps the model lists of the package.
 *
 * @param workspace - the workspace directory.
 * @returns the path of the file, and the created flag.
 */
export declare function ensureModelsFile(workspace: string): Promise<{
    readonly filePath?: string;
    readonly created: boolean;
}>;
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
export declare function readConfiguration(workspace: string): Promise<WorkspaceConfiguration>;
