/**
 * Create one directory and its parents.
 *
 * @param directory - the absolute or working-directory-relative path.
 * @returns a promise that resolves when the directory exists.
 */
export declare function ensureDirectory(directory: string): Promise<void>;
/**
 * Report whether a path exists.
 *
 * @param target - the path to test.
 * @returns true when the path exists.
 */
export declare function pathExists(target: string): Promise<boolean>;
/**
 * Read and parse one JSON file.
 *
 * @param filePath - the path of the file.
 * @returns the parsed value.
 * @throws ExperimentError when the file is absent or holds invalid JSON.
 */
export declare function readJsonFile(filePath: string): Promise<unknown>;
/**
 * Write one JSON file with two-space indentation and a final newline.
 *
 * @param filePath - the path of the file.
 * @param value - the value to write.
 * @returns a promise that resolves when the file is written.
 */
export declare function writeJsonFile(filePath: string, value: unknown): Promise<void>;
/**
 * Write one text file and add a final newline when it is absent.
 *
 * @param filePath - the path of the file.
 * @param text - the text to write.
 * @returns a promise that resolves when the file is written.
 */
export declare function writeTextFile(filePath: string, text: string): Promise<void>;
/**
 * Read one text file.
 *
 * @param filePath - the path of the file.
 * @returns the file text.
 */
export declare function readTextFile(filePath: string): Promise<string>;
/**
 * List the direct child directories of one directory.
 *
 * @param directory - the directory to read.
 * @returns the absolute child paths, sorted by name.
 */
export declare function listChildDirectories(directory: string): Promise<string[]>;
/**
 * Compute the SHA-256 digest of one text.
 *
 * @param text - the text to hash.
 * @returns the digest as lowercase hexadecimal.
 */
export declare function sha256Text(text: string): string;
/**
 * Build one session code from the start time and a random suffix.
 *
 * The code is safe as a directory name on every platform, and its lexical order is the creation
 * order.
 *
 * @param startedAt - the start time of the run.
 * @param randomSeed - the seed of the run; it makes two runs of one second distinguishable.
 * @returns the session code, for example `20260815T101500Z-20260815-a1b2c3`.
 */
export declare function createSessionCode(startedAt: Date, randomSeed: number): string;
/**
 * Make one string safe as one path segment.
 *
 * @param value - the string to convert.
 * @returns the string with each unsafe character replaced by a hyphen.
 */
export declare function safeFileSegment(value: string): string;
/**
 * Resolve one file of the packaged plugin directory.
 *
 * @param relativePath - the path relative to the package root, for example `inputs/testing-dataset`.
 * @returns the absolute path of the file.
 */
export declare function packagedPath(relativePath: string): string;
/**
 * Resolve the output root of one run.
 *
 * A relative root resolves against the workspace directory. An empty root selects the default
 * directory name below the workspace.
 *
 * @param workspace - the absolute workspace directory.
 * @param outputRoot - the configured output root, possibly empty.
 * @returns the absolute output root.
 */
export declare function resolveOutputRoot(workspace: string, outputRoot: string): string;
/**
 * Resolve an input file of a workspace.
 *
 * A workspace copy wins over the packaged copy. The function does not create a file.
 *
 * @param workspace - the absolute workspace directory.
 * @param fileName - the file name inside the inputs directory.
 * @returns the absolute path of the file to read.
 */
export declare function resolveInputPath(workspace: string, fileName: string): Promise<string>;
/**
 * Resolve the inputs directory of a workspace.
 *
 * @param workspace - the absolute workspace directory.
 * @returns the absolute inputs directory.
 */
export declare function resolveInputsDirectory(workspace: string): string;
/**
 * Wait for one delay.
 *
 * @param delayMilliseconds - the delay in milliseconds.
 * @param signal - the cancellation signal.
 * @returns a promise that settles after the delay.
 */
export declare function sleep(delayMilliseconds: number, signal?: AbortSignal): Promise<void>;
