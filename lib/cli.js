// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * The command-line interface of the plugin.
 *
 * The interface shares the experiment service with the host tools. It exists for a local run and
 * for a check of a session that the host created.
 */
import { pathToFileURL } from "node:url";
import { loadDataset } from "./dataset.js";
import { DEFAULT_RANDOM_SEED, DEFAULT_REPETITION_COUNT, DEFAULT_TOLERANCE_NATS, } from "./constants.js";
import { buildProviderEnvironments, ensureEnvironmentFile, readEnvironmentFile } from "./env.js";
import { ExperimentError, errorMessage } from "./errors.js";
import { ExperimentService } from "./experiment.js";
import { applyProviderEnvironments, loadProviderCatalog, resolveEnvironmentPrefix, resolveProviderApiKey, } from "./providers.js";
import { buildHelpText } from "./tools.js";
/** The exit code of a successful command. */
const EXIT_SUCCESS = 0;
/** The exit code of a command that fails. */
const EXIT_FAILURE = 1;
/** The exit code of a command with an invalid argument. */
const EXIT_USAGE = 2;
/**
 * Run one command line.
 *
 * @param argv - the arguments after the script name.
 * @returns the exit code.
 */
export async function runCommandLine(argv) {
    const command = argv[0] ?? "help";
    const options = parseOptions(argv.slice(1));
    const service = new ExperimentService({
        resolveWorkspace: async () => process.cwd(),
        outputRoot: () => "",
    });
    try {
        switch (command) {
            case "run":
                return await runExperimentCommand(service, options);
            case "status":
                return await showStatusCommand(service, options);
            case "report":
                return await showReportCommand(service, options);
            case "dataset":
                return await showDatasetCommand(options);
            case "env":
                return await showEnvironmentCommand();
            case "help":
                writeLine(buildCommandLineHelp());
                return EXIT_SUCCESS;
            default:
                writeError(`Unknown command: ${command}`);
                writeLine(buildCommandLineHelp());
                return EXIT_USAGE;
        }
    }
    catch (error) {
        if (error instanceof ExperimentError) {
            writeError(`${error.code}: ${error.message}`);
            return EXIT_USAGE;
        }
        writeError(errorMessage(error));
        return EXIT_FAILURE;
    }
}
/**
 * Run the run command.
 *
 * @param service - the experiment service.
 * @param options - the parsed options.
 * @returns the exit code.
 */
async function runExperimentCommand(service, options) {
    const request = {
        providerKeys: splitList(options.values.get("providers")),
        taskIds: splitList(options.values.get("tasks")),
        limit: readIntegerOption(options, "limit", 0),
        repetitions: readIntegerOption(options, "repetitions", DEFAULT_REPETITION_COUNT),
        toleranceNats: readNumberOption(options, "tolerance", DEFAULT_TOLERANCE_NATS),
        outputDirectory: options.values.get("output") ?? "",
        randomSeed: readIntegerOption(options, "seed", DEFAULT_RANDOM_SEED),
        dryRun: options.flags.has("dry-run"),
    };
    const result = await service.run(undefined, request, new AbortController().signal);
    const pairCount = result.metrics.providers.reduce((total, provider) => total + provider.pairCount, 0);
    writeLine(`Session: ${result.sessionCode}`);
    writeLine(`Directory: ${result.outputDirectory}`);
    writeLine(`Tasks: ${result.metrics.taskCount}`);
    writeLine(`Pairs: ${pairCount}`);
    for (const provider of result.metrics.providers) {
        writeLine(`- ${provider.providerKey} ${provider.provider.model}: ${provider.verdict} ` +
            `(mean symmetric KL ${provider.summary.meanSymmetricKl.toFixed(4)} nats)`);
    }
    for (const warning of result.warnings) {
        writeLine(`Warning: ${warning}`);
    }
    writeLine(`Report: ${result.reportPath}`);
    return EXIT_SUCCESS;
}
/**
 * Run the status command.
 *
 * @param service - the experiment service.
 * @param options - the parsed options.
 * @returns the exit code.
 */
async function showStatusCommand(service, options) {
    const limit = readIntegerOption(options, "limit", 5);
    const sessions = await service.listSessions(undefined, new AbortController().signal, Math.max(1, limit));
    if (sessions.length === 0) {
        writeLine("No session exists in the output root.");
        return EXIT_SUCCESS;
    }
    for (const session of sessions) {
        writeLine(`${session.sessionCode} | ${session.status} | tasks ${session.taskCount} | ` +
            `failures ${session.failures} | ${session.createdAt}`);
        for (const [provider, verdict] of Object.entries(session.verdicts)) {
            writeLine(`  - ${provider}: ${verdict}`);
        }
    }
    return EXIT_SUCCESS;
}
/**
 * Run the report command.
 *
 * @param service - the experiment service.
 * @param options - the parsed options.
 * @returns the exit code.
 */
async function showReportCommand(service, options) {
    const session = options.values.get("session") ?? "";
    const result = await service.report(undefined, new AbortController().signal, session);
    writeLine(result.text);
    return EXIT_SUCCESS;
}
/**
 * Run the env command.
 *
 * The command copies `.env.example` to `.env` when the private file is absent, and it reports the
 * usable state of each provider without printing a key.
 *
 * @returns the exit code.
 */
async function showEnvironmentCommand() {
    const workspace = process.cwd();
    const state = await ensureEnvironmentFile(workspace);
    const values = state.filePath === undefined ? {} : await readEnvironmentFile(state.filePath);
    const environments = buildProviderEnvironments(values);
    const catalog = applyProviderEnvironments(await loadProviderCatalog(), environments);
    writeLine(`Environment file: ${state.filePath ?? "absent"}`);
    writeLine(`Example file: ${state.examplePath ?? "absent"}`);
    writeLine(`Created by this command: ${state.created ? "yes" : "no"}`);
    writeLine("");
    writeLine("| Provider | Section | Model | API key |");
    writeLine("| --- | --- | --- | --- |");
    for (const provider of catalog.providers) {
        const section = resolveEnvironmentPrefix(provider);
        const key = resolveProviderApiKey(provider, environments);
        writeLine(`| ${provider.label} | ${section} | ${provider.model} | ${key === undefined ?
            "missing" : "set"} |`);
    }
    writeLine("");
    writeLine("Fill in each placeholder value of the environment file, then run the experiment.");
    return EXIT_SUCCESS;
}
/**
 * Run the dataset command.
 *
 * @param options - the parsed options.
 * @returns the exit code.
 */
async function showDatasetCommand(options) {
    const sample = Math.max(0, readIntegerOption(options, "sample", 8));
    const dataset = await loadDataset();
    const categories = new Map();
    for (const task of dataset.tasks) {
        categories.set(task.category, (categories.get(task.category) ?? 0) + 1);
    }
    writeLine(`Dataset: ${dataset.datasetId}`);
    writeLine(`Language: ${dataset.language}`);
    writeLine(`Tasks: ${dataset.tasks.length}`);
    for (const [category, count] of categories) {
        writeLine(`- ${category}: ${count}`);
    }
    for (const task of dataset.tasks.slice(0, sample)) {
        writeLine(`${task.id} [${task.category}] ${task.prefix} -> ${task.referenceToken}`);
    }
    return EXIT_SUCCESS;
}
/**
 * Parse the options of one command line.
 *
 * @param args - the arguments after the command name.
 * @returns the option set.
 */
function parseOptions(args) {
    const values = new Map();
    const flags = new Set();
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument.startsWith("--")) {
            throw new ExperimentError("INVALID_ARGUMENT", `Unexpected argument: ${argument}`);
        }
        const body = argument.slice(2);
        const equals = body.indexOf("=");
        if (equals >= 0) {
            values.set(body.slice(0, equals), body.slice(equals + 1));
            continue;
        }
        const next = args[index + 1];
        if (next !== undefined && !next.startsWith("--")) {
            values.set(body, next);
            index += 1;
            continue;
        }
        flags.add(body);
    }
    return { values, flags };
}
/**
 * Split one comma-separated option.
 *
 * @param value - the option value, or undefined.
 * @returns the list, or undefined when the value is absent.
 */
function splitList(value) {
    if (value === undefined) {
        return undefined;
    }
    const items = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
    return items;
}
/**
 * Read one integer option.
 *
 * @param options - the parsed options.
 * @param name - the option name.
 * @param fallback - the value of an absent option.
 * @returns the integer.
 */
function readIntegerOption(options, name, fallback) {
    const value = options.values.get(name);
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The option --${name} is not an integer.`);
    }
    return parsed;
}
/**
 * Read one number option.
 *
 * @param options - the parsed options.
 * @param name - the option name.
 * @param fallback - the value of an absent option.
 * @returns the number.
 */
function readNumberOption(options, name, fallback) {
    const value = options.values.get(name);
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The option --${name} is not a number.`);
    }
    return parsed;
}
/**
 * Build the command-line help text.
 *
 * @returns the help text.
 */
export function buildCommandLineHelp() {
    return [
        "Usage: node lib/cli.js <command> [options]",
        "",
        "Commands:",
        "  run       Run one experiment session.",
        "  status    List the recent sessions.",
        "  report    Print one session report.",
        "  dataset   Summarize the bundled dataset.",
        "  env       Show the environment file and the API key state.",
        "  help      Print this text.",
        "",
        "Run options:",
        "  --providers=a,b     The provider keys. The default is every enabled provider.",
        "  --tasks=T001,T002   The task identifiers. The default is every task.",
        "  --limit=N           The maximum task count. The default is 0, which selects every task.",
        `  --repetitions=N     The repetition count of each mode. The default is ${DEFAULT_REPETITION_COUNT}.`,
        "  --tolerance=X       The separation tolerance in nats. The default is 0.05.",
        "  --output=DIR        The output root. The default is .outputs in the workspace.",
        "  --seed=N            The random seed. The default is 20260815.",
        "  --concurrency=N     The maximum count of concurrent jobs.",
        "  --dry-run           Use the mock provider and no network access.",
        "",
        "Status options: --limit=N",
        "Report options: --session=CODE",
        "Dataset options: --sample=N",
        "",
        buildHelpText(),
    ].join("\n");
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
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void runCommandLine(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
