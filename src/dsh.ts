// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Minimal structural types for the DeepSeek Harness host services that this plugin uses.
 *
 * The host supplies the real implementations at load time. A local copy lets the plugin build
 * without a full DeepSeek Harness source checkout. The shapes follow the published service
 * contracts of DeepSeek Harness 0.2.x.
 */

/** A JSON value. The plugin uses it at host boundaries. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A text block of a tool result. */
export interface TextBlock {
  /** The block kind. */
  readonly type: "text";
  /** The text of the block. */
  readonly text: string;
}

/** The block kinds that this plugin renders. Other kinds pass through the host. */
export type ContentBlock = TextBlock | { readonly type: string; readonly [key: string]: unknown };

/** The output definition of a host tool. */
export interface ToolOutputDefinition {
  /** The JSON schema of the structured value that the tool returns. */
  readonly schema: Record<string, unknown>;
  /**
   * Render one tool value as content blocks.
   *
   * @param args - the arguments of the call.
   * @param value - the value that the tool returns.
   * @returns the content blocks of the host transcript.
   */
  render(args: unknown, value: JsonValue): ContentBlock[];
}

/** The run context of one host tool call. */
export interface ToolRunContext {
  /** The abort signal of the call. */
  readonly signal: AbortSignal;
  /** The agent that starts the call, when the host supplies one. */
  readonly agent?: Agent;
  /** The identifier of the call. */
  readonly callId: string;
}

/** The definition of one host tool. */
export interface ToolDefinition {
  /** The tool name that the model calls. */
  readonly name: string;
  /** The description that the model reads. */
  readonly description: string;
  /** The JSON schema of the arguments. */
  readonly parameters: Record<string, unknown>;
  /** The output schema and the renderer of the result. */
  readonly output: ToolOutputDefinition;
  /**
   * Execute one call.
   *
   * @param args - the arguments of the call.
   * @param exec - the run context of the call.
   * @returns the structured value of the call.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
  /** The timeout of one call, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The host tool registry. */
export interface ToolsService {
  /**
   * Register one tool.
   *
   * @param definition - the definition of the tool.
   * @returns the function that withdraws the registration.
   */
  register(definition: ToolDefinition): () => void;
  /**
   * Read one registered tool.
   *
   * @param name - the tool name.
   * @param scope - the optional scope of the registration.
   * @returns the definition, or undefined when the name is absent.
   */
  get(name: string, scope?: object): ToolDefinition | undefined;
  /**
   * List the registered tool names.
   *
   * @param scope - the optional scope of the registration.
   * @returns one entry for each registered tool.
   */
  schemas(scope?: object): readonly { readonly name: string }[];
}

/** The part of one agent that the plugin reads. */
export interface Agent {
  /** The identifier of the agent. */
  readonly id: string;
}

/** The host working-directory service. */
export interface WorkingDirectoryService {
  /**
   * Read the working directory of one agent and create it when it is absent.
   *
   * @param agent - the agent.
   * @param signal - the abort signal of the call.
   * @returns the absolute path of the working directory.
   */
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>;
}

/** The host logger. */
export interface Logger {
  /**
   * Write one information line.
   *
   * @param message - the message.
   * @param rest - the optional values for the message.
   */
  info(message: string, ...rest: unknown[]): void;
  /**
   * Write one warning line.
   *
   * @param message - the message.
   * @param rest - the optional values for the message.
   */
  warn(message: string, ...rest: unknown[]): void;
  /**
   * Write one error line.
   *
   * @param message - the message.
   * @param rest - the optional values for the message.
   */
  error(message: string, ...rest: unknown[]): void;
  /**
   * Write one debug line, when the host enables the debug level.
   *
   * @param message - the message.
   * @param rest - the optional values for the message.
   */
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
