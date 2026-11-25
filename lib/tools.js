// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Host tool definitions of the plugin.
 *
 * The plugin registers five tools: run, status, report, dataset, and help. Each tool returns a
 * JSON value that the host also renders as text.
 */
import { CONDITION_INJECTED_ACTUAL, CONDITION_INJECTED_SELF, CONDITION_PLAIN_ACTUAL, CONDITION_PLAIN_SELF, COMPARISON_NAMES, DEFAULT_REPETITION_COUNT, DEFAULT_TOLERANCE_NATS, PLUGIN_NAME, PLUGIN_VERSION, TOOL_DATASET, TOOL_HELP, TOOL_REPORT, TOOL_RUN, TOOL_STATUS, TOP_LOGPROBS_COUNT, } from "./constants.js";
import { ExperimentError } from "./errors.js";
import { formatNumber } from "./report.js";
/** The output schema of the run tool. */
const RUN_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["xid", "directory", "reportPath", "demosPath"],
    properties: {
        xid: { type: "string" },
        directory: { type: "string" },
        reportPath: { type: "string" },
        demosPath: { type: "string" },
        warnings: { type: "array", items: { type: "string" } },
        providers: { type: "array", items: { type: "object" } },
    },
};
/** The output schema of the status tool. */
const STATUS_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["runs"],
    properties: {
        runs: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    xid: { type: "string" },
                    directory: { type: "string" },
                    status: { type: "string" },
                    createdAt: { type: "string" },
                },
            },
        },
    },
};
/** The output schema of the report tool. */
const REPORT_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["xid", "directory", "report"],
    properties: {
        xid: { type: "string" },
        directory: { type: "string" },
        report: { type: "string" },
    },
};
/** The output schema of the dataset tool. */
const DATASET_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["datasets"],
    properties: {
        datasets: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    datasetId: { type: "string" },
                    language: { type: "string" },
                    taskCount: { type: "integer" },
                },
            },
        },
    },
};
/** The output schema of the help tool. */
const HELP_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
};
/**
 * Read one string list argument.
 *
 * @param args - the arguments of the call.
 * @param name - the argument name.
 * @returns the list, or an empty list.
 */
function readStringArray(args, name) {
    const value = args[name];
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === "string");
    }
    if (typeof value === "string" && value.trim() !== "") {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
    }
    return [];
}
/**
 * Read one integer argument.
 *
 * @param args - the arguments of the call.
 * @param name - the argument name.
 * @returns the integer, or undefined.
 */
function readInteger(args, name) {
    const value = args[name];
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Math.trunc(Number(value));
    }
    return undefined;
}
/**
 * Read one number argument.
 *
 * @param args - the arguments of the call.
 * @param name - the argument name.
 * @returns the number, or undefined.
 */
function readNumber(args, name) {
    const value = args[name];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}
/**
 * Read one string argument.
 *
 * @param args - the arguments of the call.
 * @param name - the argument name.
 * @returns the string, or undefined.
 */
function readString(args, name) {
    const value = args[name];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
/**
 * Read the arguments of one call as an object.
 *
 * @param args - the arguments of the call.
 * @returns the record, or an empty record.
 */
function readArguments(args) {
    return typeof args === "object" && args !== null ? args : {};
}
/**
 * Build the text of one run result.
 *
 * @param result - the run result.
 * @returns the text.
 */
function renderRunText(result) {
    const lines = [
        `Run ${result.xid} is complete.`,
        `Run directory: ${result.directory}`,
        `Report: ${result.reportPath}`,
        `Demos: ${result.demosPath}`,
    ];
    for (const provider of result.metrics.providers) {
        const cells = COMPARISON_NAMES.map((comparison) => {
            const summary = provider.comparisons.find((entry) => entry.comparison === comparison);
            return `${comparison}=${summary === undefined ? "n/a" : formatNumber(summary.meanSymmetricKl)}`;
        });
        lines.push(`${provider.providerKey}: ${cells.join(" ")}`);
    }
    for (const warning of result.warnings) {
        lines.push(`Warning: ${warning}`);
    }
    return lines.join("\n");
}
/**
 * Build the help text of the plugin.
 *
 * @returns the Markdown help text.
 */
export function buildHelpText() {
    return [
        `# ${PLUGIN_NAME} ${PLUGIN_VERSION}`,
        "",
        "The plugin measures the ability of a language model to predict its own next-token",
        "distribution. It asks one question with four conditions: does the model state the",
        "distribution that it produces?",
        "",
        "## Protocol",
        "",
        `1. \`${CONDITION_PLAIN_ACTUAL}\`: the served table of the next-token distribution.`,
        `2. \`${CONDITION_PLAIN_SELF}\`: the model writes the table of its own distribution as text.`,
        `3. \`${CONDITION_INJECTED_SELF}\`: the model reads the served table, and then writes its own.`,
        `4. \`${CONDITION_INJECTED_ACTUAL}\`: the model writes its own table, and then predicts with`,
        "   that table in the context.",
        "",
        "Each condition runs three times. The run computes the symmetric Kullback-Leibler divergence",
        `for each pair, with a probability floor of 1e-12 and a tolerance of ${DEFAULT_TOLERANCE_NATS} nats.`,
        "",
        "## Tools",
        "",
        `- \`${TOOL_RUN}\`: run the protocol. Arguments: \`providers\`, \`tasks\`, \`repetitions\`,`,
        "  `toleranceNats`, `outputDirectory`, `seed`, `maxConcurrency`, `topLogprobsCount`, `dryRun`.",
        `- \`${TOOL_STATUS}\`: list the recent runs of the output root.`,
        `- \`${TOOL_REPORT}\`: read the Markdown report of one run.`,
        `- \`${TOOL_DATASET}\`: describe the packaged datasets.`,
        `- \`${TOOL_HELP}\`: print this text.`,
        "",
        "## Files",
        "",
        "- `outputs/<xid>/run.json`: the manifest of the run.",
        "- `outputs/<xid>/intermediate/`: each raw request and each raw reply.",
        "- `outputs/<xid>/results/`: metrics, records, report, and tables.",
        "- `outputs/<xid>/demos/index.html`: the bilingual website of the run.",
        "",
        `The default repetition count is ${DEFAULT_REPETITION_COUNT} and the default table entry count`,
        `is ${TOP_LOGPROBS_COUNT}.`,
    ].join("\n");
}
/**
 * Create the tool definitions of the plugin.
 *
 * @param service - the experiment service.
 * @returns the definitions.
 */
export function createToolDefinitions(service) {
    const runTool = {
        name: TOOL_RUN,
        description: "Run the self-prediction protocol on a set of tasks and write a run directory with the " +
            "metrics, the report, and the demonstration website.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                providers: {
                    type: "array",
                    items: { type: "string" },
                    description: "Provider keys or model keys. An empty list selects every enabled provider.",
                },
                tasks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Task identifiers. An empty list selects every task.",
                },
                repetitions: { type: "integer", minimum: 1, maximum: 10 },
                toleranceNats: { type: "number", minimum: 0 },
                outputDirectory: { type: "string" },
                seed: { type: "integer", minimum: 0 },
                maxConcurrency: { type: "integer", minimum: 1, maximum: 16 },
                topLogprobsCount: { type: "integer", minimum: 2, maximum: 64 },
                dryRun: {
                    type: "boolean",
                    description: "Use the mock provider and no network access.",
                },
            },
        },
        output: {
            schema: RUN_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const result = value;
                return [{ type: "text", text: renderRunText(result) }];
            },
        },
        execute: async (args, exec) => {
            const values = readArguments(args);
            return service.run(exec.agent, {
                providerKeys: readStringArray(values, "providers"),
                taskIds: readStringArray(values, "tasks"),
                repetitions: readInteger(values, "repetitions"),
                toleranceNats: readNumber(values, "toleranceNats"),
                outputDirectory: readString(values, "outputDirectory"),
                randomSeed: readInteger(values, "seed"),
                maxConcurrency: readInteger(values, "maxConcurrency"),
                topLogprobsCount: readInteger(values, "topLogprobsCount"),
                dryRun: values.dryRun === true,
            }, exec.signal);
        },
        timeoutMs: 7_200_000,
    };
    const statusTool = {
        name: TOOL_STATUS,
        description: "List the recent runs of the output root with their status.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        },
        output: {
            schema: STATUS_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const runs = value.runs;
                if (runs.length === 0) {
                    return [{ type: "text", text: "The output root holds no run." }];
                }
                const lines = runs.map((run) => `${run.xid}  ${run.status}  ${run.createdAt}  ${run.directory}`);
                return [{ type: "text", text: lines.join("\n") }];
            },
        },
        execute: async (args, exec) => {
            const values = readArguments(args);
            const runs = await service.status(exec.agent, exec.signal, readInteger(values, "limit") ?? 5);
            return {
                runs: runs.map((run) => ({
                    xid: run.xid,
                    directory: run.directory,
                    status: run.status,
                    createdAt: run.createdAt,
                })),
            };
        },
    };
    const reportTool = {
        name: TOOL_REPORT,
        description: "Read the Markdown report of one run. An empty session selects the newest run.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: { session: { type: "string" } },
        },
        output: {
            schema: REPORT_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const report = value;
                return [
                    {
                        type: "text",
                        text: `Report of ${report.xid} at ${report.directory}\n\n${report.report}`,
                    },
                ];
            },
        },
        execute: async (args, exec) => {
            const values = readArguments(args);
            return service.report(exec.agent, exec.signal, readString(values, "session"));
        },
    };
    const datasetTool = {
        name: TOOL_DATASET,
        description: "Describe the datasets of the workspace.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: { sample: { type: "integer", minimum: 0, maximum: 32 } },
        },
        output: {
            schema: DATASET_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const datasets = value.datasets;
                const lines = datasets.map((dataset) => `${dataset.datasetId}  ${dataset.language}  ${dataset.taskCount} tasks  ` +
                    `${dataset.description}`);
                return [{ type: "text", text: lines.join("\n") }];
            },
        },
        execute: async (args, exec) => {
            const values = readArguments(args);
            const datasets = await service.datasetSummary(exec.agent, exec.signal, readInteger(values, "sample") ?? 8);
            return { datasets };
        },
    };
    const helpTool = {
        name: TOOL_HELP,
        description: "Print the protocol, the tools, and the file layout of the plugin.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
        output: {
            schema: HELP_OUTPUT_SCHEMA,
            render: (_args, value) => [
                { type: "text", text: value.text },
            ],
        },
        execute: async () => ({ text: buildHelpText() }),
    };
    return [runTool, statusTool, reportTool, datasetTool, helpTool];
}
/**
 * Register each tool of the plugin.
 *
 * @param tools - the host tool registry.
 * @param service - the experiment service.
 * @returns one disposer for each registration.
 */
export function registerTools(tools, service) {
    const disposers = [];
    for (const definition of createToolDefinitions(service)) {
        try {
            disposers.push(tools.register(definition));
        }
        catch (error) {
            throw new ExperimentError("INVALID_ARGUMENT", `The tool ${definition.name} cannot register: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return disposers;
}
