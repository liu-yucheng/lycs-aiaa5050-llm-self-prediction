/**
 * Minimal structural types for the DeepSeek Harness host services that this plugin uses.
 *
 * The host supplies the real implementations at load time. A local copy lets the plugin build
 * without a full DeepSeek Harness source checkout. The shapes follow the published service
 * contracts of DeepSeek Harness 0.2.x.
 */
/** A JSON value. The plugin uses it at host boundaries. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** A text block of a tool result. */
export interface TextBlock {
    readonly type: "text";
    readonly text: string;
}
/** The block kinds that this plugin renders. Other kinds pass through the host. */
export type ContentBlock = TextBlock | {
    readonly type: string;
    readonly [key: string]: unknown;
};
/** The output definition of a host tool. */
export interface ToolOutputDefinition {
    readonly schema: Record<string, unknown>;
    render(args: unknown, value: JsonValue): ContentBlock[];
}
/** The run context of one host tool call. */
export interface ToolRunContext {
    readonly signal: AbortSignal;
    readonly agent?: Agent;
    readonly callId: string;
}
/** The definition of one host tool. */
export interface ToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly output: ToolOutputDefinition;
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
    readonly timeoutMs?: number;
}
/** The host tool registry. */
export interface ToolsService {
    register(definition: ToolDefinition): () => void;
    get(name: string, scope?: object): ToolDefinition | undefined;
    schemas(scope?: object): readonly {
        readonly name: string;
    }[];
}
/** The part of one agent that the plugin reads. */
export interface Agent {
    readonly id: string;
}
/** The host working-directory service. */
export interface WorkingDirectoryService {
    ensure(agent: Agent, signal?: AbortSignal): Promise<string>;
}
/** The host logger. */
export interface Logger {
    info(message: string, ...rest: unknown[]): void;
    warn(message: string, ...rest: unknown[]): void;
    error(message: string, ...rest: unknown[]): void;
    debug?(message: string, ...rest: unknown[]): void;
}
/** The Cordis plugin context. The host provides every member. */
export interface PluginContext {
    readonly tools: ToolsService;
    effect(callback: () => void | (() => void), label?: string): () => void;
    get<T = unknown>(name: string): T | undefined;
    readonly logger?: Logger;
    readonly workingDirectory?: WorkingDirectoryService;
}
