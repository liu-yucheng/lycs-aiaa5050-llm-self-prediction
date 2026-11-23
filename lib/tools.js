// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * The host tools of the plugin.
 *
 * Each tool declares a JSON output schema and a render function that returns one text block. The
 * tools are plain objects. The host tool registry accepts a plain object, so the plugin needs no
 * runtime dependency on a host package.
 */
import { DATASET_FILE_NAME, DEFAULT_REPETITION_COUNT, DEFAULT_TOLERANCE_NATS, TOP_LOGPROBS_COUNT, TOOL_DATASET, TOOL_HELP, TOOL_REPORT, TOOL_RUN, TOOL_STATUS, } from "./constants.js";
import { loadDataset } from "./dataset.js";
import { ExperimentError, isRecord } from "./errors.js";
/** The schema of an empty parameter list. */
const EMPTY_PARAMETERS = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
};
/** The schema of one provider and verdict row. */
const VERDICT_ROW_SCHEMA = {
    type: "object",
    properties: {
        provider: { type: "string", description: "The provider key." },
        verdict: { type: "string", description: "The verdict of the provider." },
    },
    required: ["provider", "verdict"],
    additionalProperties: false,
};
/** The schema of the run result. */
const RUN_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        sessionCode: { type: "string", description: "The session code." },
        outputDirectory: { type: "string", description: "The absolute session directory." },
        reportPath: { type: "string", description: "The absolute path of the report." },
        taskCount: { type: "integer", description: "The task count of the session." },
        pairCount: { type: "integer", description: "The pair count of the session." },
        verdicts: {
            type: "array",
            description: "The verdict of each provider.",
            items: VERDICT_ROW_SCHEMA,
        },
        warnings: {
            type: "array",
            description: "The warnings of the session.",
            items: { type: "string" },
        },
    },
    required: [
        "sessionCode",
        "outputDirectory",
        "reportPath",
        "taskCount",
        "pairCount",
        "verdicts",
        "warnings",
    ],
    additionalProperties: false,
};
/** The schema of one session row. */
const SESSION_ROW_SCHEMA = {
    type: "object",
    properties: {
        sessionCode: { type: "string", description: "The session code." },
        directory: { type: "string", description: "The absolute session directory." },
        status: { type: "string", description: "The session status." },
        createdAt: { type: "string", description: "The creation time in ISO 8601 format." },
        taskCount: { type: "integer", description: "The task count of the session." },
        failures: { type: "integer", description: "The count of failed calls." },
        verdicts: {
            type: "array",
            description: "The verdict of each provider.",
            items: VERDICT_ROW_SCHEMA,
        },
    },
    required: ["sessionCode", "directory", "status", "createdAt", "taskCount", "failures", "verdicts"],
    additionalProperties: false,
};
/** The schema of the status result. */
const STATUS_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        sessions: {
            type: "array",
            description: "The sessions, newest first.",
            items: SESSION_ROW_SCHEMA,
        },
    },
    required: ["sessions"],
    additionalProperties: false,
};
/** The schema of the report result. */
const REPORT_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        sessionCode: { type: "string", description: "The session code." },
        path: { type: "string", description: "The absolute path of the report." },
        text: { type: "string", description: "The report text in Markdown." },
    },
    required: ["sessionCode", "path", "text"],
    additionalProperties: false,
};
/** The schema of one listed task. */
const TASK_ROW_SCHEMA = {
    type: "object",
    properties: {
        id: { type: "string", description: "The task identifier." },
        category: { type: "string", description: "The task category." },
        prefix: { type: "string", description: "The sentence prefix." },
        referenceToken: { type: "string", description: "The reference next token." },
    },
    required: ["id", "category", "prefix", "referenceToken"],
    additionalProperties: false,
};
/** The schema of the dataset result. */
const DATASET_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        datasetId: { type: "string", description: "The dataset identifier." },
        language: { type: "string", description: "The dataset language tag." },
        taskCount: { type: "integer", description: "The task count." },
        categories: {
            type: "array",
            description: "The task count of each category.",
            items: {
                type: "object",
                properties: {
                    category: { type: "string", description: "The category name." },
                    count: { type: "integer", description: "The task count of the category." },
                },
                required: ["category", "count"],
                additionalProperties: false,
            },
        },
        tasks: {
            type: "array",
            description: "The listed tasks.",
            items: TASK_ROW_SCHEMA,
        },
    },
    required: ["datasetId", "language", "taskCount", "categories", "tasks"],
    additionalProperties: false,
};
/** The schema of the help result. */
const HELP_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        text: { type: "string", description: "The help text in Markdown." },
    },
    required: ["text"],
    additionalProperties: false,
};
/**
 * Register every tool of the plugin.
 *
 * @param tools - the host tool registry.
 * @param service - the experiment service.
 * @returns one disposer for each registered tool.
 */
export function registerTools(tools, service) {
    return createToolDefinitions(service).map((definition) => tools.register(definition));
}
/**
 * Create the definition of each tool.
 *
 * @param service - the experiment service.
 * @returns the tool definitions in registration order.
 */
export function createToolDefinitions(service) {
    return [
        createRunTool(service),
        createStatusTool(service),
        createReportTool(service),
        createDatasetTool(service),
        createHelpTool(),
    ];
}
/**
 * Create the run tool.
 *
 * @param service - the experiment service.
 * @returns the tool definition.
 */
function createRunTool(service) {
    return {
        name: TOOL_RUN,
        description: "Run the next-token self-prediction experiment. Each selected task asks a provider for one " +
            "next-token distribution and then for a self-predicted distribution. The tool writes one " +
            "session directory with the raw replies, the records, the metrics, and a report. The default " +
            `repetition count is ${DEFAULT_REPETITION_COUNT}. Use dryRun for a mock run without network.`,
        parameters: {
            type: "object",
            properties: {
                providers: {
                    type: "array",
                    description: "The provider keys. An empty list selects every enabled provider.",
                    items: { type: "string" },
                },
                tasks: {
                    type: "array",
                    description: "The task identifiers. An empty list selects every task.",
                    items: { type: "string" },
                },
                limit: {
                    type: "integer",
                    description: "The maximum task count. A value of 0 selects every task.",
                },
                repetitions: {
                    type: "integer",
                    description: `The repetition count of each mode. The default is ${DEFAULT_REPETITION_COUNT}.`,
                },
                toleranceNats: {
                    type: "number",
                    description: `The separation tolerance in nats. The default is ${DEFAULT_TOLERANCE_NATS}. ` +
                        "A symmetric KL divergence below the tolerance is indistinguishable from zero.",
                },
                outputDirectory: {
                    type: "string",
                    description: "The output root. An empty string uses the configured output root.",
                },
                seed: { type: "integer", description: "The random seed of the bootstrap interval." },
                maxConcurrency: {
                    type: "integer",
                    description: "The maximum count of concurrent task jobs.",
                },
                dryRun: {
                    type: "boolean",
                    description: "Use the mock provider and no network access.",
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: RUN_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const data = value;
                const lines = [
                    `Session: ${data.sessionCode}`,
                    `Directory: ${data.outputDirectory}`,
                    `Tasks: ${data.taskCount}`,
                    `Pairs: ${data.pairCount}`,
                ];
                for (const row of data.verdicts) {
                    lines.push(`- ${row.provider}: ${row.verdict}`);
                }
                const shown = data.warnings.slice(0, 10);
                for (const warning of shown) {
                    lines.push(`Warning: ${warning}`);
                }
                if (data.warnings.length > shown.length) {
                    lines.push(`Warning count: ${data.warnings.length}`);
                }
                lines.push(`Report: ${data.reportPath}`);
                return [{ type: "text", text: lines.join("\n") }];
            },
        },
        timeoutMs: 3_600_000,
        execute: async (args, exec) => {
            const request = buildRunRequest(args);
            const result = await service.run(exec.agent, request, exec.signal);
            const pairCount = result.metrics.providers.reduce((total, provider) => total + provider.pairCount, 0);
            const value = {
                sessionCode: result.sessionCode,
                outputDirectory: result.outputDirectory,
                reportPath: result.reportPath,
                taskCount: result.metrics.taskCount,
                pairCount,
                verdicts: result.metrics.providers.map((provider) => ({
                    provider: provider.providerKey,
                    verdict: provider.verdict,
                })),
                warnings: result.warnings,
            };
            return value;
        },
    };
}
/**
 * Create the status tool.
 *
 * @param service - the experiment service.
 * @returns the tool definition.
 */
function createStatusTool(service) {
    return {
        name: TOOL_STATUS,
        description: "Report the state of the recent experiment sessions. The tool lists the session code, the " +
            "status, the task count, the failed call count, and the verdict of each provider.",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "integer",
                    description: "The maximum count of listed sessions. The default is 5.",
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: STATUS_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const data = value;
                if (data.sessions.length === 0) {
                    return [{ type: "text", text: "No session exists in the output root." }];
                }
                const lines = [];
                for (const session of data.sessions) {
                    lines.push(`${session.sessionCode} | ${session.status} | tasks ${session.taskCount} | ` +
                        `failures ${session.failures} | ${session.createdAt}`);
                    for (const row of session.verdicts) {
                        lines.push(`  - ${row.provider}: ${row.verdict}`);
                    }
                }
                return [{ type: "text", text: lines.join("\n") }];
            },
        },
        execute: async (args, exec) => {
            const record = isRecord(args) ? args : {};
            const limit = readInteger(record["limit"], "limit", 5);
            const sessions = await service.listSessions(exec.agent, exec.signal, Math.max(1, Math.min(50, limit)));
            const value = {
                sessions: sessions.map((session) => ({
                    sessionCode: session.sessionCode,
                    directory: session.directory,
                    status: session.status,
                    createdAt: session.createdAt,
                    taskCount: session.taskCount,
                    failures: session.failures,
                    verdicts: Object.entries(session.verdicts).map(([provider, verdict]) => ({
                        provider,
                        verdict,
                    })),
                })),
            };
            return value;
        },
    };
}
/**
 * Create the report tool.
 *
 * @param service - the experiment service.
 * @returns the tool definition.
 */
function createReportTool(service) {
    return {
        name: TOOL_REPORT,
        description: "Read the Markdown report of one experiment session. An empty session code selects the " +
            "latest session.",
        parameters: {
            type: "object",
            properties: {
                session: {
                    type: "string",
                    description: "The session code. An empty string selects the latest session.",
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: REPORT_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const data = value;
                return [{ type: "text", text: data.text }];
            },
        },
        execute: async (args, exec) => {
            const record = isRecord(args) ? args : {};
            const session = readString(record["session"], "session", "");
            const result = await service.report(exec.agent, exec.signal, session);
            const value = {
                sessionCode: result.sessionCode,
                path: result.path,
                text: result.text,
            };
            return value;
        },
    };
}
/**
 * Create the dataset tool.
 *
 * @param service - the experiment service.
 * @returns the tool definition.
 */
function createDatasetTool(service) {
    return {
        name: TOOL_DATASET,
        description: `Summarize the read-only dataset ${DATASET_FILE_NAME}. The tool lists the task count, the ` +
            "count of each category, and the first tasks with the prefix and the reference token.",
        parameters: {
            type: "object",
            properties: {
                sample: {
                    type: "integer",
                    description: "The count of listed tasks. The default is 8.",
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: DATASET_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const data = value;
                const lines = [
                    `Dataset: ${data.datasetId}`,
                    `Language: ${data.language}`,
                    `Tasks: ${data.taskCount}`,
                ];
                for (const row of data.categories) {
                    lines.push(`- ${row.category}: ${row.count}`);
                }
                for (const task of data.tasks) {
                    lines.push(`${task.id} [${task.category}] ${task.prefix} -> ${task.referenceToken}`);
                }
                return [{ type: "text", text: lines.join("\n") }];
            },
        },
        execute: async (args) => {
            const record = isRecord(args) ? args : {};
            const sample = Math.max(0, Math.min(128, readInteger(record["sample"], "sample", 8)));
            const summary = await service.datasetSummary();
            const dataset = await loadDataset();
            const tasks = dataset.tasks.slice(0, sample).map((task) => ({
                id: task.id,
                category: task.category,
                prefix: task.prefix,
                referenceToken: task.referenceToken,
            }));
            const value = {
                datasetId: summary.datasetId,
                language: summary.language,
                taskCount: summary.taskCount,
                categories: Object.entries(summary.categories).map(([category, count]) => ({
                    category,
                    count,
                })),
                tasks,
            };
            return value;
        },
    };
}
/**
 * Create the help tool.
 *
 * @returns the tool definition.
 */
function createHelpTool() {
    return {
        name: TOOL_HELP,
        description: "Explain the next-token self-prediction experiment, the provider setup, and the tool set.",
        parameters: EMPTY_PARAMETERS,
        output: {
            schema: HELP_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const data = value;
                return [{ type: "text", text: data.text }];
            },
        },
        execute: async () => ({ text: buildHelpText() }),
    };
}
/**
 * Build the help text.
 *
 * @returns the help text in Markdown.
 */
export function buildHelpText() {
    return [
        "# Next-token self-prediction",
        "",
        "The experiment asks one language model two questions about the same sentence prefix.",
        "",
        "1. Next-token prediction: the model returns the top log probabilities of the next token.",
        "2. Next-token self-prediction: a forced tool call asks the model to report the same table.",
        "",
        "The run computes the two-way Kullback-Leibler divergence of each actual and self pair. A value",
        "close to zero supports the self-prediction hypothesis. A value above the tolerance supports",
        "the null hypothesis.",
        "",
        "## Provider setup",
        "",
        "The plugin reads `inputs/providers.json` and the private `.env` file of the workspace.",
        "The example file `.env.example` holds one section for each provider, with the properties",
        "`<prefix>.base_url`, `<prefix>.model_to_use`, and `<prefix>.api_key`. When `.env` is absent,",
        "the plugin copies the example and asks you to fill in the keys before a real run.",
        "",
        "- `deepseek`: section `deepseek`",
        "- `qwen`: section `qwen`",
        "- `glm`: section `zhipu`",
        "",
        "The `mock` provider needs no network and no credential. Use it for a dry run.",
        "",
        "## Tools",
        "",
        `- ${TOOL_RUN}: run one session.`,
        `- ${TOOL_STATUS}: list the recent sessions.`,
        `- ${TOOL_REPORT}: read one report.`,
        `- ${TOOL_DATASET}: summarize the dataset.`,
        `- ${TOOL_HELP}: show this text.`,
        "",
        "## Files",
        "",
        "Each session directory holds `session.json`, `tasks.json`, `metrics.json`, `report.md`,",
        "`summary.csv`, `tasks.csv`, `raw/`, and `records/`. The plugin never edits a raw reply.",
        "",
        `The actual request uses top ${TOP_LOGPROBS_COUNT} log probabilities.`,
    ].join("\n");
}
/**
 * Build one run request from the tool arguments.
 *
 * @param args - the tool arguments.
 * @returns the run request.
 */
export function buildRunRequest(args) {
    const record = isRecord(args) ? args : {};
    const request = {
        providerKeys: readStringArray(record["providers"], "providers"),
        taskIds: readStringArray(record["tasks"], "tasks"),
        limit: readInteger(record["limit"], "limit", 0),
        repetitions: readInteger(record["repetitions"], "repetitions", DEFAULT_REPETITION_COUNT),
        toleranceNats: readNumber(record["toleranceNats"], "toleranceNats", DEFAULT_TOLERANCE_NATS),
        outputDirectory: readOptionalString(record["outputDirectory"], "outputDirectory"),
        randomSeed: readOptionalInteger(record["seed"], "seed"),
        maxConcurrency: readOptionalInteger(record["maxConcurrency"], "maxConcurrency"),
        dryRun: record["dryRun"] === true,
    };
    return request;
}
/**
 * Read one string array argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @returns the string array, or undefined when the value is absent.
 */
function readStringArray(value, name) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The argument ${name} is not an array.`);
    }
    const result = [];
    for (const item of value) {
        if (typeof item !== "string") {
            throw new ExperimentError("INVALID_ARGUMENT", `The argument ${name} holds a non-string.`);
        }
        const trimmed = item.trim();
        if (trimmed !== "") {
            result.push(trimmed);
        }
    }
    return result;
}
/**
 * Read one integer argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @param fallback - the value of an absent argument.
 * @returns the integer.
 */
function readInteger(value, name, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The argument ${name} is not a number.`);
    }
    return Math.trunc(value);
}
/**
 * Read one optional integer argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @returns the integer, or undefined when the value is absent.
 */
function readOptionalInteger(value, name) {
    if (value === undefined || value === null) {
        return undefined;
    }
    return readInteger(value, name, 0);
}
/**
 * Read one number argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @param fallback - the value of an absent argument.
 * @returns the number.
 */
function readNumber(value, name, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The argument ${name} is not a number.`);
    }
    return value;
}
/**
 * Read one string argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @param fallback - the value of an absent argument.
 * @returns the string.
 */
function readString(value, name, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value !== "string") {
        throw new ExperimentError("INVALID_ARGUMENT", `The argument ${name} is not a string.`);
    }
    return value.trim();
}
/**
 * Read one optional string argument.
 *
 * @param value - the raw value.
 * @param name - the argument name.
 * @returns the trimmed string, or undefined when the value is absent or empty.
 */
function readOptionalString(value, name) {
    const text = readString(value, name, "");
    return text === "" ? undefined : text;
}
