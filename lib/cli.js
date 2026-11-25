// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Command line of the plugin.
 *
 * The command line runs the same service as the host tools, so a terminal and a host tool produce
 * the same files. Each command reads the environment file below the workspace and never prints a
 * key.
 */
import process from "node:process";
import { pathToFileURL } from "node:url";
import { COMPARISON_NAMES, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { ExperimentService } from "./experiment.js";
import { buildProviderEnvironments, ensureEnvironmentFile, readEnvironmentFile } from "./env.js";
import { resolveProviderApiKey, loadProviderCatalog, applyProviderEnvironments } from "./providers.js";
import { formatNumber } from "./report.js";
import { buildHelpText } from "./tools.js";
import { PROVIDER_FILE_NAME } from "./constants.js";
import { resolveInputPath } from "./files.js";
/** The exit code of a successful command. */
const EXIT_SUCCESS = 0;
/** The exit code of a failed command. */
const EXIT_FAILURE = 1;
/** The exit code of a usage error. */
const EXIT_USAGE = 2;
/**
 * Read the options of one command.
 *
 * The parser accepts `--name value` and `--name=value`. A flag without a value becomes `true`.
 *
 * @param argv - the arguments after the command name.
 * @returns the options and the positional arguments.
 */
function parseOptions(argv) {
    const options = {};
    const positionals = [];
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === undefined) {
            continue;
        }
        if (!value.startsWith("--")) {
            positionals.push(value);
            continue;
        }
        const body = value.slice(2);
        const separator = body.indexOf("=");
        if (separator >= 0) {
            options[body.slice(0, separator)] = body.slice(separator + 1);
            continue;
        }
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
            options[body] = true;
            continue;
        }
        options[body] = next;
        index += 1;
    }
    return { options, positionals };
}
/**
 * Split one comma-separated list.
 *
 * @param value - the option value.
 * @returns the items.
 */
function splitList(value) {
    if (typeof value !== "string") {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}
/**
 * Read one integer option.
 *
 * @param value - the option value.
 * @returns the integer, or undefined.
 */
function readIntegerOption(value) {
    if (typeof value !== "string" || !Number.isFinite(Number(value))) {
        return undefined;
    }
    return Math.trunc(Number(value));
}
/**
 * Read one number option.
 *
 * @param value - the option value.
 * @returns the number, or undefined.
 */
function readNumberOption(value) {
    if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Number(value))) {
        return undefined;
    }
    return Number(value);
}
/**
 * Write one line to the standard output.
 *
 * @param text - the text.
 */
function writeLine(text) {
    process.stdout.write(`${text}\n`);
}
/**
 * Write one line to the standard error.
 *
 * @param text - the text.
 */
function writeError(text) {
    process.stderr.write(`${text}\n`);
}
/**
 * Build the usage text of the command line.
 *
 * @returns the text.
 */
function buildCommandLineHelp() {
    return [
        `${PLUGIN_NAME} ${PLUGIN_VERSION}`,
        "",
        "Usage: node lib/cli.js <command> [options]",
        "",
        "Commands:",
        "  run       Run the four conditions and write one run directory.",
        "  status    List the recent runs of the output root.",
        "  report    Print the Markdown report of one run.",
        "  dataset   Describe the datasets of the workspace.",
        "  env       Show the environment file and the provider keys.",
        "  help      Print the protocol of the plugin.",
        "",
        "Options of run:",
        "  --providers a,b        Provider keys or model keys.",
        "  --tasks Z001,E001      Task identifiers.",
        "  --repetitions 3        Repetition count of one condition.",
        "  --tolerance 0.05       Tolerance in nats.",
        "  --output outputs       Output root.",
        "  --seed 20260815        Random seed.",
        "  --concurrency 3        Number of tasks that run at the same time.",
        "  --entries 20           Table entry count.",
        "  --dry-run              Use the mock provider.",
        "",
        "Options of status:",
        "  --limit 5              Number of runs to list.",
        "",
        "Options of report:",
        "  --session <xid>        Run identifier. An empty value selects the newest run.",
        "",
        "Options of dataset:",
        "  --sample 8             Number of tasks to show for each file.",
    ].join("\n");
}
/**
 * Run one command line.
 *
 * @param argv - the arguments after the program name.
 * @returns the exit code.
 */
export async function runCommandLine(argv) {
    const command = argv[0] ?? "help";
    const { options, positionals } = parseOptions(argv.slice(1));
    const workspace = process.cwd();
    const service = new ExperimentService({
        resolveWorkspace: async () => workspace,
        outputRoot: () => (typeof options.output === "string" ? options.output : ""),
    });
    try {
        if (command === "run") {
            const result = await service.run(undefined, {
                providerKeys: splitList(options.providers),
                taskIds: splitList(options.tasks),
                repetitions: readIntegerOption(options.repetitions),
                toleranceNats: readNumberOption(options.tolerance),
                outputDirectory: typeof options.output === "string" ? options.output : undefined,
                randomSeed: readIntegerOption(options.seed),
                maxConcurrency: readIntegerOption(options.concurrency),
                topLogprobsCount: readIntegerOption(options.entries),
                dryRun: options["dry-run"] === true,
            });
            writeLine(`Run ${result.xid} is complete.`);
            writeLine(`Run directory: ${result.directory}`);
            writeLine(`Report: ${result.reportPath}`);
            writeLine(`Demos: ${result.demosPath}`);
            for (const provider of result.metrics.providers) {
                const cells = COMPARISON_NAMES.map((comparison) => {
                    const summary = provider.comparisons.find((entry) => entry.comparison === comparison);
                    return `${comparison}=${summary === undefined ? "n/a" : formatNumber(summary.meanSymmetricKl)}`;
                });
                writeLine(`${provider.providerKey} ${provider.model}: ${cells.join(" ")}`);
            }
            for (const warning of result.warnings) {
                writeLine(`Warning: ${warning}`);
            }
            return EXIT_SUCCESS;
        }
        if (command === "status") {
            const runs = await service.status(undefined, undefined, readIntegerOption(options.limit) ?? 5);
            if (runs.length === 0) {
                writeLine("The output root holds no run.");
                return EXIT_SUCCESS;
            }
            for (const run of runs) {
                writeLine(`${run.xid}  ${run.status}  ${run.createdAt}  ${run.directory}`);
            }
            return EXIT_SUCCESS;
        }
        if (command === "report") {
            const session = typeof options.session === "string" ? options.session : (positionals[0] ?? "");
            const result = await service.report(undefined, undefined, session);
            writeLine(result.report);
            return EXIT_SUCCESS;
        }
        if (command === "dataset") {
            const datasets = await service.datasetSummary(undefined, undefined, readIntegerOption(options.sample) ?? 8);
            for (const dataset of datasets) {
                writeLine(`${dataset.datasetId}  ${dataset.language}  ${dataset.taskCount} tasks`);
                for (const task of dataset.sample) {
                    writeLine(`  ${task.id}  ${task.prefix}[${task.referenceToken}]`);
                }
            }
            return EXIT_SUCCESS;
        }
        if (command === "env") {
            const state = await ensureEnvironmentFile(workspace);
            writeLine(`Environment file: ${state.filePath ?? "(none)"}`);
            writeLine(`Example file: ${state.examplePath ?? "(none)"}`);
            writeLine(`Created by this command: ${state.created ? "yes" : "no"}`);
            const values = state.filePath === undefined ? {} : await readEnvironmentFile(state.filePath);
            const environments = buildProviderEnvironments(values);
            const catalogPath = await resolveInputPath(workspace, PROVIDER_FILE_NAME);
            const catalog = applyProviderEnvironments(await loadProviderCatalog(catalogPath), environments);
            for (const definition of catalog.providers) {
                const key = resolveProviderApiKey(definition, environments);
                writeLine(`${definition.key}  ${definition.enabled ? "enabled" : "disabled"}  ` +
                    `${definition.model}  key=${key === undefined ? "missing" : "present"}`);
            }
            return EXIT_SUCCESS;
        }
        if (command === "help") {
            writeLine(buildCommandLineHelp());
            writeLine("");
            writeLine(buildHelpText());
            return EXIT_SUCCESS;
        }
        writeError(`Unknown command: ${command}`);
        writeError(buildCommandLineHelp());
        return EXIT_USAGE;
    }
    catch (error) {
        writeError(error instanceof Error ? error.message : String(error));
        return EXIT_FAILURE;
    }
}
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
    const code = await runCommandLine(process.argv.slice(2));
    process.exitCode = code;
}
