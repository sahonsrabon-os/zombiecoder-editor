import * as vscode from 'vscode';
import { GatewayClient } from '../api/client';
import { OpenAIChatCompletionRequest, OpenAIMessage } from '../api/types';
import { buildChatRequest, OpenAIToolDefinition, ToolChoice } from '../api/requestBuilder';
import { GatewayConfig } from '../config/gatewayConfig';
import { buildSystemMessage } from '../mission/contextBuilder';
import { EvidenceGate, GatedStreamReporter } from '../mission/evidenceGate';
import { MissionContext } from '../mission/missionManager';
import { sanitizeMessages } from '../mission/promptSanitizer';
import { resolvePerModelOptions } from '../config/perModelOptions';
import { REQUEST_SAMPLER_KEYS } from '../discovery/types';
import {
  TOKEN_CONSTANTS,
  buildInputText,
  calculateMaxInputTokens,
  calculateSafeMaxOutputTokens,
  estimateTextTokens,
  truncateMessagesToFit,
} from '../chat/tokenBudget';
import { tryRepairJson } from '../chat/jsonRepair';
import { fillMissingRequiredProperties } from '../chat/toolSchema';
import {
  StreamChunk,
  StreamReporter,
  isEmptyStreamResult,
  streamResponse,
} from '../chat/responseStreamer';
import { friendlyModelName } from '../models/modelDisplay';
import { TokenUsage } from '../status/sessionStats';
import { ModelCatalog } from './modelCatalog';
import { getProductName } from '../branding';
import { convertAllMessages } from './vscodeParts';
import { handleChatError } from './notifications';

const DEFAULT_TEMPERATURE = 0.7;
const DEBUG_REQUEST_MAX_LOG_LENGTH = 2000;
const MAX_TOOL_ARGS_LOG_LENGTH = 1000;
const MAX_TOOL_DESCRIPTION_LOG_LENGTH = 100;

/**
 * Optimized tool selection tuning. The Copilot catalog can hand the provider
 * ~71 tools; several small/quantized servers return an EMPTY response when
 * they receive that many tool definitions on top of the Mission context
 * (~50K input tokens). We cut the list to the tools relevant to the user's
 * actual request — fewer tools, same capabilities, no empty replies.
 */
const MAX_TOOLS_PER_REQUEST = 40;
const MIN_TOOLS_PER_REQUEST = 8;

/**
 * Tools whose NAMES match these patterns are always kept regardless of
 * relevance — they cover the most common coding actions (edit, read, write,
 * run, search, workspace) so the model is never left without the basics.
 */
const CORE_TOOL_PATTERNS: RegExp[] = [
  /edit/i, /write/i, /read/i, /file/i, /terminal/i, /run/i,
  /search/i, /grep/i, /glob/i, /diagnostic/i, /workspace/i,
  /explain/i, /fix/i, /test/i, /review/i, /open/i, /select/i,
  /mission/i, /agent/i, /mcp/i, /memory/i, /ssot/i, /web/i,
  /browser/i, /directory/i, /list/i,
];

/** Common English words that carry no tool-selection signal. */
const TOOL_SELECTION_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'i', 'you', 'we', 'they',
  'he', 'she', 'it', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'their', 'me', 'us', 'him', 'her', 'them', 'can', 'could', 'will', 'would',
  'should', 'shall', 'may', 'might', 'must', 'do', 'does', 'did', 'have',
  'has', 'had', 'please', 'help', 'need', 'want', 'get', 'make', 'let',
  'show', 'tell', 'find', 'check', 'see', 'use', 'using', 'used', 'via', 'by',
  'am', 'not', 'no', 'yes', 'ok', 'okay', 'please', 'thanks', 'thank', 'hi', 'hello',
]);

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the text of the LAST user message in the conversation — the part
 * that actually asks for something. Tool selection is scored against this
 * text, so the model only receives the tools it is likely to need.
 */
function extractUserPrompt(
  messages: readonly vscode.LanguageModelChatMessage[]
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== vscode.LanguageModelChatMessageRole.User) {
      continue;
    }
    const parts = message.content;
    if (!Array.isArray(parts)) {
      return String((message as { content?: unknown }).content ?? '');
    }
    const text = parts
      .filter((p) => p instanceof vscode.LanguageModelTextPart)
      .map((p) => (p as vscode.LanguageModelTextPart).value)
      .join(' ')
      .trim();
    if (text) {
      return text;
    }
  }
  return '';
}

/** Return `value` when it's a finite number, else `undefined`. */
function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Forward the backend-discovered sampler params (see REQUEST_SAMPLER_KEYS —
 * excludes temperature, which is resolved explicitly, and context/seed) so
 * the server doesn't default an omitted value — notably `top_p`, which
 * Ollama's OpenAI endpoint otherwise fills with 1.0, overriding the
 * Modelfile.
 */
function discoveredSamplerOptions(
  discovered: Readonly<Record<string, number>> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!discovered) { return out; }
  for (const key of REQUEST_SAMPLER_KEYS) {
    if (typeof discovered[key] === 'number') { out[key] = discovered[key]; }
  }
  return out;
}

/**
 * MIME type VS Code 1.120 watches for on `LanguageModelDataPart`s to extract
 * BYOK / language-model-provider token usage and feed it into the chat
 * context-window widget. See microsoft/vscode#315394.
 */
const USAGE_DATA_PART_MIME_TYPE = 'usage';

/**
 * Lifecycle event the status bar (and any other listener) consumes to render
 * live request state. Exactly one terminal event (`complete` or `error`)
 * follows every `start` event for the same request.
 */
export type RequestStateEvent =
  | { readonly kind: 'start'; readonly modelId: string; readonly modelName: string }
  | {
    readonly kind: 'complete';
    readonly modelId: string;
    readonly modelName: string;
    readonly usage?: TokenUsage;
  }
  | {
    readonly kind: 'error';
    readonly modelId: string;
    readonly modelName: string;
    readonly errorMessage: string;
  };

/**
 * Format a tool's description for the output channel: trim, truncate at
 * MAX_TOOL_DESCRIPTION_LOG_LENGTH characters, and only append `...` when an
 * actual truncation happened. Returns `'(none)'` when the tool didn't supply
 * a description at all.
 */
function formatToolDescription(description: string | undefined): string {
  if (!description) { return '(none)'; }
  if (description.length <= MAX_TOOL_DESCRIPTION_LOG_LENGTH) { return description; }
  return `${description.substring(0, MAX_TOOL_DESCRIPTION_LOG_LENGTH)}...`;
}

/**
 * Map a `LanguageModelChatToolMode` enum value to a human-readable label for
 * the output channel. The enum is numeric at runtime, so the raw `${toolMode}`
 * was rendering as `0` / `1` and looked like a stray index.
 */
function describeToolMode(toolMode: vscode.LanguageModelChatToolMode | undefined): string {
  if (toolMode === undefined) { return 'unset'; }
  if (toolMode === vscode.LanguageModelChatToolMode.Required) { return 'required'; }
  if (toolMode === vscode.LanguageModelChatToolMode.Auto) { return 'auto'; }
  return String(toolMode);
}

interface ChatRequestHandlerDeps {
  client: GatewayClient;
  catalog: ModelCatalog;
  getConfig: () => GatewayConfig;
  log: (message: string) => void;
  /** Fired on start / complete / error so the status bar renders live state. */
  onRequestState: (event: RequestStateEvent) => void;
  /** Capture a successful request in the session totals / status dialog. */
  onCompleted: (modelId: string, modelName: string, usage: TokenUsage | undefined) => void;
  /** Opens the extension's output channel (used by error prompts). */
  showOutput: () => void;
  /** Optional Mission Barisal context provider (Phase 1/2 — SSOT + sanitizer). */
  getMissionContext?: () => MissionContext | undefined;
}

/**
 * Executes one chat request end-to-end: convert VS Code messages to the
 * OpenAI wire format, budget the context window, build and stream the
 * request, and transparently retry once when the server's context-overflow
 * error teaches us the model's real window (issue #55).
 *
 * Stateless between requests — all cross-request knowledge (learned context
 * sizes, cached model data) lives in the {@link ModelCatalog}.
 */
export class ChatRequestHandler {
  constructor(private readonly deps: ChatRequestHandlerDeps) { }

  /**
   * Phase 2 pipeline: strip the Microsoft/Copilot middleman system prompt
   * (dālāli) so Mission Barisal agents only ever see the user's real input,
   * then prepend a clean Mission Barisal system message carrying the local
   * SSOT, syllabus and session memory.
   *
   * `missionContext` is captured once per request by {@link handle} so the
   * .zombiecoder files are not re-read on every retry attempt.
   */
  private buildFinalMessages(
    rawMessages: OpenAIMessage[],
    missionContext: MissionContext | undefined,
    log: (message: string) => void
  ): OpenAIMessage[] {
    const sanitized = sanitizeMessages(rawMessages, log);
    if (missionContext) {
      const systemMessage = buildSystemMessage(missionContext);
      if (systemMessage) {
        return [systemMessage, ...sanitized];
      }
    }
    return sanitized;
  }

  public async handle(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const { log, catalog } = this.deps;
    log(`Sending chat request to model: ${model.id}`);
    log(
      `Tool mode: ${describeToolMode(options.toolMode)}, Tools: ${options.tools?.length ?? 0}`
    );
    log(`Message count: ${messages.length}`);

    const modelName = friendlyModelName(model.id);
    this.deps.onRequestState({ kind: 'start', modelId: model.id, modelName });

    const config = this.deps.getConfig();
    // Phase 1/2/3: capture the Mission context once per request — reused for
    // the clean system message AND the evidence gate decision.
    const missionContext = this.deps.getMissionContext?.();
    const rawMessages = convertAllMessages(messages, config.enableImageInput, log);
    const openAIMessages = this.buildFinalMessages(rawMessages, missionContext, log);
    log(`Converted to ${openAIMessages.length} OpenAI messages`);
    this.logMessageStructure(openAIMessages);

    // Optimized tool selection: the LAST user message drives which tools are
    // sent, so a 71-tool catalog is cut to the relevant subset (~15-40).
    const userPrompt = extractUserPrompt(messages);

    const configuredMaxOutput =
      model.maxOutputTokens || TOKEN_CONSTANTS.DEFAULT_OUTPUT_TOKENS;

    // Filter the tool catalog up-front so the token budget reflects what we
    // actually send on the wire. Otherwise the unfiltered Copilot tool catalog
    // (~93 tools, ~24K chars) would reserve context that gets thrown away by
    // buildToolsConfig() later — collapsing the user's prompt when tool
    // calling is disabled.
    //
    // Tool calling can be disabled for one transparent retry: many servers
    // fail to generate ANY output when handed 70+ tools, so when the model
    // returns an empty response we retry once without tools so the user still
    // gets an answer. `toolsEnabled` flips once, then stays off.
    let toolsEnabled = true;
    let retriedWithoutTools = false;

    // Once anything has been streamed to the chat view we can no longer
    // transparently re-issue the request without duplicating output, so track
    // whether the wrapped progress ever fired.
    let partsReported = false;
    const trackingProgress: vscode.Progress<vscode.LanguageModelResponsePart> = {
      report: (part) => {
        partsReported = true;
        progress.report(part);
      },
    };

    let capturedUsage: TokenUsage | undefined;

    // The whole budget → request → stream pipeline, resolved against the
    // model's current context size, so a corrected context can re-run it.
    const attempt = async (): Promise<void> => {
      const { tools: filteredTools, schemas: toolSchemas } = this.buildToolsConfig(config, options, toolsEnabled, userPrompt);
      const toolsSerializedLength = filteredTools ? JSON.stringify(filteredTools).length : 0;
      const modelMaxContext = catalog.resolveModelMaxContext(model);
      const maxInputTokens = calculateMaxInputTokens({
        modelMaxContext,
        configuredMaxOutput,
        toolsSerializedLength,
      });

      const truncatedMessages = truncateMessagesToFit(openAIMessages, maxInputTokens, log);
      if (truncatedMessages.length < openAIMessages.length) {
        log(
          `WARNING: Truncated conversation from ${openAIMessages.length} to ${truncatedMessages.length} messages to fit context limit`
        );
      }

      const inputText = buildInputText(truncatedMessages);
      const toolsOverhead = Math.ceil(toolsSerializedLength / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
      const estimatedInputTokens = estimateTextTokens(inputText);
      const safeMaxOutputTokens = calculateSafeMaxOutputTokens({
        estimatedInputTokens,
        toolsOverhead,
        modelMaxContext,
        configuredMaxOutput,
      });

      log(
        `Token estimate: input=${estimatedInputTokens}, tools=${toolsOverhead}, model_context=${modelMaxContext}, chosen_max_tokens=${safeMaxOutputTokens}`
      );
      if (safeMaxOutputTokens <= TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS) {
        log(
          `WARNING: max_tokens clamped to floor (${safeMaxOutputTokens}); input does not fit the context window even after truncation — responses will be cut off`
        );
      }

      const hasTools = filteredTools !== undefined && filteredTools.length > 0;

      // Sampler resolution, precedence high -> low:
      //   caller modelOptions > perModelOptions > extraModelOptions >
      //   backend-discovered params (e.g. Ollama Modelfile via /api/show) >
      //   agentTemperature / DEFAULT_TEMPERATURE fallback.
      // agentTemperature was previously applied unconditionally because
      // backend params were never discovered; it is now a genuine last-resort
      // fallback. Forwarding the discovered top_p also stops Ollama's OpenAI
      // endpoint defaulting an omitted top_p to 1.0.
      const perModel = resolvePerModelOptions(model.id, config.perModelOptions);
      const discovered = catalog.getDiscoveredParams(model.id);

      const configuredTemperature =
        pickNumber(options.modelOptions?.temperature) ??
        pickNumber(perModel.temperature) ??
        pickNumber(config.extraModelOptions?.temperature);
      const temperature =
        configuredTemperature ??
        pickNumber(discovered?.temperature) ??
        (hasTools ? config.agentTemperature : DEFAULT_TEMPERATURE);

      const requestOptions = buildChatRequest({
        model: model.id,
        messages: truncatedMessages,
        maxTokens: safeMaxOutputTokens,
        temperature,
        tools: filteredTools,
        toolChoice: hasTools ? this.mapToolChoice(options.toolMode) : undefined,
        parallelToolCalls: hasTools ? config.parallelToolCalling : undefined,
        extraOptions: {
          ...discoveredSamplerOptions(discovered),
          ...config.extraModelOptions,
          ...perModel,
          ...options.modelOptions,
        },
      });

      if (hasTools) {
        log(
          `Sending ${filteredTools.length} tools to model (parallel: ${config.parallelToolCalling})`
        );
      }

      this.logRequest(config, requestOptions);

      // Phase 3: when Mission Barisal mode is active, wrap the stream reporter
      // in the evidence gate. Text parts are buffered until the stream ends,
      // then flushed either as the proven response or as an honest
      // "no proof" message (syllabus 8.6). Thinking/tool calls stream live.
      const innerReporter = this.createStreamReporter(trackingProgress, (usage) => {
        capturedUsage = usage;
      });
      const gate = missionContext ? new EvidenceGate() : undefined;
      const gatedReporter = gate
        ? new GatedStreamReporter(innerReporter, gate, log)
        : undefined;
      const reporter: StreamReporter = gatedReporter ?? innerReporter;

      const chunks = this.deps.client.streamChatCompletion(requestOptions, token);
      const stats = await streamResponse({
        chunks: chunks as AsyncIterable<StreamChunk>,
        reporter,
        isCancelled: () => token.isCancellationRequested,
        resolveToolCallArgs: (toolCall) => this.resolveToolCallArgs(toolCall, toolSchemas),
      });

      // Evidence gate: evaluate the buffered response now that the stream is
      // complete — flush the response (proven) or the truth message (not).
      gatedReporter?.flush();

      log(
        `Completed chat request, received ${stats.totalContentLength} chars, ${stats.totalTextParts} text parts, ${stats.totalToolCalls} tool calls`
      );

      if (isEmptyStreamResult(stats)) {
        const toolCount = filteredTools?.length ?? 0;
        if (toolCount > 0 && !retriedWithoutTools && !partsReported) {
          retriedWithoutTools = true;
          toolsEnabled = false;
          log(
            'WARNING: Empty response with tool calling enabled — retrying once WITHOUT tools so the model can still answer.'
          );
          await attempt();
          return;
        }
        this.handleEmptyResponse(model, inputText, openAIMessages.length, toolCount, trackingProgress);
      }
    };

    try {
      try {
        await attempt();
      } catch (error) {
        // Context-overflow errors carry the server's real context size
        // (issue #55: llama-server router mode reports nothing up-front, so
        // the first request can overshoot). Learn it and, if nothing has been
        // streamed to the chat view yet, transparently retry once with the
        // corrected budget.
        if (
          !catalog.learnContextSizeFromError(model, error) ||
          partsReported ||
          token.isCancellationRequested
        ) {
          throw error;
        }
        log('Retrying chat request with corrected context size...');
        await attempt();
      }
      this.deps.onCompleted(model.id, modelName, capturedUsage);
      this.deps.onRequestState({
        kind: 'complete',
        modelId: model.id,
        modelName,
        usage: capturedUsage,
      });
    } catch (error) {
      this.deps.onRequestState({
        kind: 'error',
        modelId: model.id,
        modelName,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      handleChatError(error, log, this.deps.showOutput);
    }
  }

  // ---------- tool config + stream adapters ----------

  private mapToolChoice(toolMode: vscode.LanguageModelChatToolMode | undefined): ToolChoice | undefined {
    switch (toolMode) {
      case vscode.LanguageModelChatToolMode.Required:
        return 'required';
      case vscode.LanguageModelChatToolMode.Auto:
        return 'auto';
      default:
        return undefined;
    }
  }

  /**
   * Optimized tool selection — cut the Copilot catalog (often ~71 tools, ~50K
   * input tokens with the Mission context) down to the tools actually relevant
   * to the user's request:
   *   1. deduplicate by name (MCP tools can collide with Copilot built-ins),
   *   2. score each tool by keyword overlap between the user prompt and the
   *      tool's name + description (name matches score higher),
   *   3. always keep the core editing/search/terminal tools,
   *   4. cap at MAX_TOOLS_PER_REQUEST (still far below the raw catalog).
   *
   * Sending 71 tools makes several small/quantized servers return an EMPTY
   * response ("Tools provided: 71, Estimated input tokens: 50471"). Fewer,
   * relevant tools keep the model responsive without losing capabilities.
   */
  private selectTools(
    tools: readonly vscode.LanguageModelChatTool[],
    userPrompt: string
  ): vscode.LanguageModelChatTool[] {
    // 1) Deduplicate by name (keep the first occurrence).
    const seen = new Set<string>();
    const unique: vscode.LanguageModelChatTool[] = [];
    for (const tool of tools) {
      if (!tool.name || seen.has(tool.name)) { continue; }
      seen.add(tool.name);
      unique.push(tool);
    }
    if (unique.length <= MIN_TOOLS_PER_REQUEST) {
      return unique;
    }

    // 2) Significant tokens from the user's latest message.
    const tokens = new Set<string>();
    for (const word of userPrompt.toLowerCase().split(/[^a-z0-9_]+/i)) {
      if (word.length < 3 || TOOL_SELECTION_STOPWORDS.has(word)) { continue; }
      tokens.add(word);
    }

    // 3) Score each tool: name match = +2, description match = +1.
    const scored = unique.map((tool) => {
      const name = tool.name.toLowerCase();
      const description = (tool.description ?? '').toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const tokenRe = new RegExp(`\\b${escapeRegExp(token)}\\b`);
        if (tokenRe.test(name)) {
          score += 2;
        } else if (description.includes(token)) {
          score += 1;
        }
      }
      const isCore = CORE_TOOL_PATTERNS.some((p) => p.test(tool.name));
      return { tool, score, isCore };
    });

    // 4) Core first, then highest score, then name — cap the total.
    scored.sort((a, b) => {
      if (a.isCore !== b.isCore) { return a.isCore ? -1 : 1; }
      if (b.score !== a.score) { return b.score - a.score; }
      return a.tool.name.localeCompare(b.tool.name);
    });

    const cap = Math.max(
      MIN_TOOLS_PER_REQUEST,
      Math.min(MAX_TOOLS_PER_REQUEST, unique.length)
    );
    return scored.slice(0, cap).map((s) => s.tool);
  }

  private buildToolsConfig(
    config: GatewayConfig,
    options: vscode.ProvideLanguageModelChatResponseOptions,
    toolsEnabledOverride = true,
    userPrompt = ''
  ): {
    tools: OpenAIToolDefinition[] | undefined;
    schemas: Map<string, Record<string, unknown> | undefined>;
  } {
    const schemas = new Map<string, Record<string, unknown> | undefined>();
    if (
      !toolsEnabledOverride ||
      !config.enableToolCalling ||
      !options.tools ||
      options.tools.length === 0
    ) {
      return { tools: undefined, schemas };
    }

    // Optimized tool selection: relevance-scored, deduplicated, capped.
    const selected = this.selectTools(options.tools, userPrompt);
    if (selected.length < options.tools.length) {
      this.deps.log(
        `Optimized tool selection: ${options.tools.length} → ${selected.length} tools ` +
        `(dropped ${options.tools.length - selected.length} irrelevant for request)`
      );
    }

    const tools: OpenAIToolDefinition[] = selected.map((tool) => {
      this.deps.log(`Tool: ${tool.name}`);
      this.deps.log(`  Description: ${formatToolDescription(tool.description)}`);

      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      schemas.set(tool.name, schema);

      if (schema?.required && Array.isArray(schema.required)) {
        this.deps.log(
          `  Required properties: ${(schema.required as string[]).join(', ')}`
        );
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });

    return { tools, schemas };
  }

  /**
   * Parse and patch tool call arguments before reporting them upstream.
   * The schemas map is per-request so concurrent chat requests can't clobber
   * each other's tool definitions.
   */
  private resolveToolCallArgs(
    toolCall: { id: string; name: string; arguments: string },
    toolSchemas: Map<string, Record<string, unknown> | undefined>
  ): Record<string, unknown> {
    const { log } = this.deps;
    log(`\n=== TOOL CALL RECEIVED ===`);
    log(`  ID: ${toolCall.id}`);
    log(`  Name: ${toolCall.name}`);
    log(
      `  Raw arguments: ${toolCall.arguments.substring(0, MAX_TOOL_ARGS_LOG_LENGTH)}${toolCall.arguments.length > MAX_TOOL_ARGS_LOG_LENGTH ? '...' : ''
      }`
    );

    let args = tryRepairJson(toolCall.arguments, log) as Record<string, unknown> | null;

    if (args === null) {
      log(`  ERROR: Failed to parse tool call arguments`);
      log(`  Full arguments: ${toolCall.arguments}`);
      args = {};
    } else {
      const argKeys = Object.keys(args);
      log(
        `  Parsed argument keys: ${argKeys.length > 0 ? argKeys.join(', ') : '(none)'}`
      );
    }

    const toolSchema = toolSchemas.get(toolCall.name);
    if (toolSchema) {
      args = fillMissingRequiredProperties(args, toolSchema, log);
    }

    log(`=== END TOOL CALL ===\n`);
    return args;
  }

  private createStreamReporter(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    onUsage?: (usage: TokenUsage) => void
  ): StreamReporter {
    return {
      reportText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      reportThinking: (text) => progress.report(new vscode.LanguageModelThinkingPart(text)),
      reportThinkingDone: () =>
        progress.report(new vscode.LanguageModelThinkingPart('', '', { vscode_reasoning_done: true })),
      reportToolCall: (id, name, args) =>
        progress.report(new vscode.LanguageModelToolCallPart(id, name, args)),
      reportUsage: (usage) => {
        // VS Code 1.120 picks up token usage emitted as a LanguageModelDataPart
        // with the literal mime type `usage` (see microsoft/vscode#315394).
        // The shape mirrors OpenAI's `usage` object. Surfacing it here makes
        // the chat view's context-window widget render real numbers instead
        // of `0%` for gateway models (issue #24).
        this.deps.log(
          `Usage: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`
        );
        onUsage?.({
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        });
        const payload = new TextEncoder().encode(JSON.stringify(usage));
        progress.report(new vscode.LanguageModelDataPart(payload, USAGE_DATA_PART_MIME_TYPE));
      },
    };
  }

  // ---------- logging / error helpers ----------

  private logMessageStructure(openAIMessages: readonly OpenAIMessage[]): void {
    for (let i = 0; i < openAIMessages.length; i++) {
      const msg = openAIMessages[i];
      const toolCallId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : 'none';
      let hasContent: boolean;
      if (typeof msg.content === 'string') {
        hasContent = msg.content.length > 0;
      } else if (Array.isArray(msg.content)) {
        hasContent = msg.content.length > 0;
      } else {
        hasContent = msg.content !== null && msg.content !== undefined;
      }
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      this.deps.log(
        `  Message ${i + 1}: role=${msg.role}, hasContent=${hasContent}, hasToolCalls=${hasToolCalls}, toolCallId=${toolCallId}`
      );
    }
  }

  private logRequest(config: GatewayConfig, request: OpenAIChatCompletionRequest): void {
    if (!config.verboseLogging) {
      // By default log only the non-content envelope so user conversation
      // data (file contents, tool args, credentials pasted into chat) is
      // not captured in logs they may share for support.
      const toolCount = Array.isArray(request.tools) ? request.tools.length : 0;
      this.deps.log(
        `Request: model=${request.model}, messages=${request.messages.length}, tools=${toolCount}, max_tokens=${request.max_tokens}, temperature=${request.temperature}`
      );
      return;
    }
    const debugRequest = JSON.stringify(request, null, 2);
    this.deps.log(
      debugRequest.length > DEBUG_REQUEST_MAX_LOG_LENGTH
        ? `Request (truncated): ${debugRequest.substring(0, DEBUG_REQUEST_MAX_LOG_LENGTH)}...`
        : `Request: ${debugRequest}`
    );
  }

  private handleEmptyResponse(
    model: vscode.LanguageModelChatInformation,
    inputText: string,
    messageCount: number,
    toolCount: number,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    const { log } = this.deps;
    const inputTokenCount = estimateTextTokens(inputText);
    const modelMaxContext = this.deps.catalog.resolveModelMaxContext(model);

    log(`WARNING: Model returned empty response with no tool calls.`);
    log(`  Input tokens estimated: ${inputTokenCount}`);
    log(`  Messages in conversation: ${messageCount}`);
    log(`  Tools provided: ${toolCount}`);

    const errorHint =
      toolCount > 0
        ? `The model returned an empty response. This typically indicates the model failed to generate valid output with tool calling enabled. Check the inference server logs for errors.`
        : `The model returned an empty response. Check the inference server logs for details.`;

    log(`  Issue: ${errorHint}`);

    const errorMessage =
      `I was unable to generate a response. ${errorHint}\n\n` +
      `Diagnostic info:\n- Model: ${model.id}\n- Tools provided: ${toolCount}\n` +
      `- Estimated input tokens: ${inputTokenCount}\n- Context limit: ${modelMaxContext}\n\n` +
      `Check the "${getProductName()}" output panel for detailed logs.`;

    progress.report(new vscode.LanguageModelTextPart(errorMessage));
  }
}
