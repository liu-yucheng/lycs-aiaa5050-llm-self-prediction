/** The override values of one provider section. */
export interface ProviderEnvironment {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly apiKey?: string;
}
/** The state of the environment file of one directory. */
export interface EnvironmentFileState {
    readonly directory: string;
    readonly filePath?: string;
    readonly examplePath?: string;
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
 * `model_to_use`, and `api_key`. It ignores any other property and any key without a dot.
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
 * Ensure the private environment file of one directory.
 *
 * The function returns the existing file when it is present. When the file is absent, the function
 * copies the example file of the directory, or the packaged example file, and reports that it
 * created the file. The created file holds placeholder values.
 *
 * @param directory - the directory that holds the experiment.
 * @returns the state of the environment file.
 */
export declare function ensureEnvironmentFile(directory: string): Promise<EnvironmentFileState>;
