/**
 * Run one command line.
 *
 * @param argv - the arguments after the script name.
 * @returns the exit code.
 */
export declare function runCommandLine(argv: readonly string[]): Promise<number>;
/**
 * Build the command-line help text.
 *
 * @returns the help text.
 */
export declare function buildCommandLineHelp(): string;
