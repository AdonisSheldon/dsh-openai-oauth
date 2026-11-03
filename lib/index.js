import { a as OPENAI_CODEX_PROVIDER, i as CredentialStoreError, n as AuthController, o as SecureCredentialStore, r as AuthControllerError, s as resolveDshHome, t as createOpenAiOAuth } from "./src.js";
import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, attributionHeaders, contentHasImage, offloadedImageText } from "@deepseek-ai/dsh-llm";
import { isIP } from "node:net";
//#region src/models.ts
/** Return the selectable reasoning levels declared by one model. */
function getSupportedThinkingLevels(model) {
	return [
		"off",
		"none",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"ultra"
	].filter((level) => model.thinkingLevelMap?.[level] !== null && model.thinkingLevelMap?.[level] !== void 0);
}
//#endregion
//#region src/replay.ts
/** Lossless OpenAI Codex assistant replay metadata. */
function parseArguments(raw) {
	try {
		const value = JSON.parse(raw);
		if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
	} catch {}
	return {};
}
function emptyUsage$1() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
/** Project a completed Codex response into durable JSON replay metadata. */
function toCodexReplayState(message) {
	return {
		response: {
			kind: "openai-codex",
			version: 1,
			api: message.api,
			provider: message.provider,
			model: message.model,
			...message.responseModel === void 0 ? {} : { responseModel: message.responseModel },
			...message.responseId === void 0 ? {} : { responseId: message.responseId },
			stopReason: message.stopReason
		},
		blocks: message.content.map((block) => {
			switch (block.type) {
				case "text": return {
					type: "text",
					...block.textSignature === void 0 ? {} : { textSignature: block.textSignature }
				};
				case "thinking": return {
					type: "reasoning",
					...block.thinkingSignature === void 0 ? {} : { thinkingSignature: block.thinkingSignature },
					...block.redacted === void 0 ? {} : { redacted: block.redacted }
				};
				case "toolCall": return {
					type: "tool-call",
					...block.thoughtSignature === void 0 ? {} : { thoughtSignature: block.thoughtSignature }
				};
			}
		})
	};
}
function invalidReplay(message) {
	throw new LlmError(`invalid OpenAI Codex replay state: ${message}`, "INVALID_REPLAY_STATE");
}
function readReplayState(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidReplay("expected a replay envelope");
	const envelope = value;
	const rawResponse = envelope["response"];
	if (typeof rawResponse !== "object" || rawResponse === null || Array.isArray(rawResponse)) return invalidReplay("expected a response object");
	const response = rawResponse;
	if (response["kind"] !== "openai-codex" || response["version"] !== 1) return invalidReplay("unsupported kind or version");
	for (const key of [
		"api",
		"provider",
		"model"
	]) if (typeof response[key] !== "string" || response[key].length === 0) return invalidReplay(`${key} must be a non-empty string`);
	if (![
		"stop",
		"length",
		"toolUse",
		"error",
		"aborted"
	].includes(String(response["stopReason"]))) return invalidReplay("unknown stop reason");
	if (response["responseModel"] !== void 0 && typeof response["responseModel"] !== "string") return invalidReplay("responseModel must be a string");
	if (response["responseId"] !== void 0 && typeof response["responseId"] !== "string") return invalidReplay("responseId must be a string");
	const blocks = envelope["blocks"];
	if (!Array.isArray(blocks)) return invalidReplay("blocks must be an array");
	for (const [index, value] of blocks.entries()) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidReplay(`block ${index} must be an object`);
		const block = value;
		if (![
			"text",
			"reasoning",
			"tool-call"
		].includes(String(block["type"]))) return invalidReplay(`block ${index} has an unknown type`);
		for (const field of [
			"textSignature",
			"thinkingSignature",
			"thoughtSignature"
		]) if (block[field] !== void 0 && typeof block[field] !== "string") return invalidReplay(`block ${index} ${field} must be a string`);
		if (block["redacted"] !== void 0 && typeof block["redacted"] !== "boolean") return invalidReplay(`block ${index} redacted must be boolean`);
	}
	return {
		response,
		blocks
	};
}
function foreignAssistant(message) {
	const source = message.source.kind === "model" ? message.source : void 0;
	const content = [];
	for (const block of message.content) switch (block.type) {
		case "text":
			content.push({
				type: "text",
				text: block.text
			});
			break;
		case "reasoning":
			content.push({
				type: "thinking",
				thinking: block.text
			});
			break;
		case "tool-call":
			content.push({
				type: "toolCall",
				id: block.id,
				name: block.name,
				arguments: parseArguments(block.arguments)
			});
			break;
		default: throw new LlmError(`OpenAI Codex cannot replay assistant content type "${block.type}"`, "UNSUPPORTED_CONTENT");
	}
	return {
		role: "assistant",
		content,
		api: "dsh-foreign",
		provider: source?.provider ?? "dsh-foreign",
		model: source?.model ?? "dsh-foreign",
		usage: emptyUsage$1(),
		stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
		timestamp: 0
	};
}
function replayedAssistant(message, source, raw) {
	const state = readReplayState(raw);
	if (state.response.provider !== source.provider || state.response.model !== source.model) return invalidReplay("provider or model does not match source");
	if (state.blocks.length !== message.content.length) return invalidReplay("block count does not match content");
	return {
		role: "assistant",
		content: message.content.map((block, index) => {
			const replay = state.blocks[index];
			if (replay === void 0 || replay.type !== block.type) return invalidReplay(`block ${index} does not match content`);
			switch (block.type) {
				case "text": return {
					type: "text",
					text: block.text,
					...replay.type === "text" && replay.textSignature !== void 0 ? { textSignature: replay.textSignature } : {}
				};
				case "reasoning": return {
					type: "thinking",
					thinking: block.text,
					...replay.type === "reasoning" && replay.thinkingSignature !== void 0 ? { thinkingSignature: replay.thinkingSignature } : {},
					...replay.type === "reasoning" && replay.redacted !== void 0 ? { redacted: replay.redacted } : {}
				};
				case "tool-call": return {
					type: "toolCall",
					id: block.id,
					name: block.name,
					arguments: parseArguments(block.arguments),
					...replay.type === "tool-call" && replay.thoughtSignature !== void 0 ? { thoughtSignature: replay.thoughtSignature } : {}
				};
				default: return invalidReplay(`block ${index} has unsupported content`);
			}
		}),
		api: state.response.api,
		provider: state.response.provider,
		model: state.response.model,
		...state.response.responseModel === void 0 ? {} : { responseModel: state.response.responseModel },
		...state.response.responseId === void 0 ? {} : { responseId: state.response.responseId },
		usage: emptyUsage$1(),
		stopReason: state.response.stopReason,
		timestamp: 0
	};
}
/** Reconstruct one Codex assistant history message from Harness content. */
function toCodexAssistant(message) {
	const source = message.source;
	return source.kind === "model" && source.replayState !== void 0 ? replayedAssistant(message, source, source.replayState) : foreignAssistant(message);
}
//#endregion
//#region src/context.ts
/** Harness-to-Codex request conversion. */
function unsupported(type, role) {
	throw new LlmError(`OpenAI Codex cannot represent ${type} content in a ${role} message`, "UNSUPPORTED_CONTENT");
}
async function userContent(blocks, attachments, signal) {
	const content = [];
	for (const block of blocks) switch (block.type) {
		case "text":
			if (block.text.length > 0) content.push({
				type: "text",
				text: block.text
			});
			break;
		case "image": {
			if (block.offloaded) {
				content.push({
					type: "text",
					text: offloadedImageText(block.attachment)
				});
				break;
			}
			if (attachments === void 0) throw new LlmError("OpenAI Codex image input requires the Harness attachment service", "UNSUPPORTED_CONTENT");
			const stored = await attachments.readImage(block.attachment, signal);
			content.push({
				type: "image",
				data: Buffer.from(stored.data).toString("base64"),
				mimeType: stored.ref.mediaType
			});
			break;
		}
		default: unsupported(block.type, "user");
	}
	return content.every((block) => block.type === "text") ? content.map((block) => block.text).join("") : content;
}
function toolsOf(options) {
	return options.tools?.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
}
/** Convert the complete Harness request into one fresh Codex context. */
async function toCodexContext(options, attachments) {
	const toolNames = /* @__PURE__ */ new Map();
	const messages = [];
	let systemPrompt = options.system;
	for (const message of options.messages) {
		if (message.role === "system") {
			if (message.content.some((block) => block.type !== "text")) unsupported("non-text", "system");
			const text = message.content.map((block) => block.type === "text" ? block.text : "").join("");
			systemPrompt = options.system === void 0 ? text : `${options.system}\n\n${text}`;
			continue;
		}
		if (message.role === "developer") unsupported("developer", message.role);
		if (message.role === "assistant") {
			const assistant = toCodexAssistant(message);
			for (const block of assistant.content) if (block.type === "toolCall") toolNames.set(ToolCallId(block.id), block.name);
			messages.push(assistant);
			continue;
		}
		const content = await userContent(message.content, attachments, options.signal);
		if (message.role === "tool") messages.push({
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: toolNames.get(message.toolCallId) ?? "unknown",
			content: typeof content === "string" ? [{
				type: "text",
				text: content || "(no output)"
			}] : content,
			isError: message.isError ?? false,
			timestamp: 0
		});
		else messages.push({
			role: "user",
			content,
			timestamp: 0
		});
	}
	const tools = toolsOf(options);
	return {
		...systemPrompt === void 0 ? {} : { systemPrompt },
		messages,
		...tools !== void 0 && tools.length > 0 ? { tools } : {}
	};
}
//#endregion
//#region src/stream.ts
/** OpenAI Codex-to-Harness stream conversion. */
/** Map Codex usage fields into Harness usage. */
function mapUsage(usage) {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
		...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
		...usage.reasoning === void 0 ? {} : { reasoningTokens: usage.reasoning }
	};
}
function providerFailure(message) {
	if (/Provider is not configured|No API key/i.test(message)) return {
		code: "MISSING_CREDENTIAL",
		message: "OpenAI Codex is not signed in. Sign in with Browser or Device Code."
	};
	if (/\b(?:401|403)\b|unauthori[sz]ed|invalid.?grant/i.test(message)) return {
		code: "AUTH",
		message: "OpenAI Codex authentication failed. Sign in again."
	};
	if (/\b429\b|rate.?limit/i.test(message)) return {
		code: "RATE_LIMIT",
		message: "OpenAI Codex rate limit reached. Retry later."
	};
	if (/quota|billing|insufficient.?credits/i.test(message)) return {
		code: "QUOTA_EXCEEDED",
		message: "OpenAI Codex quota is unavailable for this account."
	};
	if (/time(?:d)?\s*out|timeout/i.test(message)) return {
		code: "TIMEOUT",
		message: "OpenAI Codex request timed out."
	};
	if (/network|connection|socket|fetch|ECONN[A-Z]+|terminated|premature close/i.test(message)) return {
		code: "TRANSPORT",
		message: "OpenAI Codex transport failed."
	};
	return {
		code: "CODEX_ERROR",
		message: "OpenAI Codex request failed."
	};
}
/** Convert a thrown provider failure without retaining its message or cause. */
function redactedCodexError(error) {
	const failure = providerFailure(error instanceof Error ? error.message : "");
	return new LlmError(failure.message, failure.code);
}
function stopReason(message, contextWindow) {
	if (message.stopReason === "error" && /context.{0,20}(?:window|length|token)/i.test(message.errorMessage ?? "") || contextWindow !== void 0 && message.usage.input >= contextWindow) return {
		kind: "error",
		failure: {
			code: CONTEXT_WINDOW_EXCEEDED_CODE,
			message: "OpenAI Codex context window was exceeded."
		}
	};
	switch (message.stopReason) {
		case "stop": return message.content.length === 0 ? {
			kind: "error",
			failure: {
				code: EMPTY_RESPONSE_CODE,
				message: "OpenAI Codex returned an empty response."
			}
		} : { kind: "stop" };
		case "length": return { kind: "max-tokens" };
		case "toolUse": return { kind: "tool-calls" };
		case "aborted": return {
			kind: "aborted",
			failure: {
				code: "ABORTED",
				message: "OpenAI Codex request was aborted."
			}
		};
		case "error": return {
			kind: "error",
			failure: providerFailure(message.errorMessage ?? "")
		};
	}
}
/** Translate one Codex event stream into Harness chunks. */
async function* toStreamChunks(events, contextWindow) {
	const tools = /* @__PURE__ */ new Map();
	for await (const event of events) switch (event.type) {
		case "start": break;
		case "text_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "text"
			};
			break;
		case "text_delta":
			yield {
				type: "text-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "text_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "text",
					text: event.content
				}
			};
			break;
		case "thinking_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "reasoning"
			};
			break;
		case "thinking_delta":
			yield {
				type: "reasoning-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "thinking_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "reasoning",
					text: event.content
				}
			};
			break;
		case "toolcall_start": {
			const partial = event.partial.content[event.contentIndex];
			tools.set(event.contentIndex, partial?.type === "toolCall" ? {
				id: partial.id,
				name: partial.name
			} : {
				id: "",
				name: ""
			});
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "tool-call"
			};
			break;
		}
		case "toolcall_delta": {
			const tool = tools.get(event.contentIndex);
			yield {
				type: "tool-call-delta",
				index: event.contentIndex,
				id: ToolCallId(tool?.id ?? ""),
				...tool?.name === void 0 || tool.name.length === 0 ? {} : { name: tool.name },
				argumentsDelta: event.delta
			};
			break;
		}
		case "toolcall_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "tool-call",
					id: ToolCallId(event.toolCall.id),
					name: event.toolCall.name,
					arguments: JSON.stringify(event.toolCall.arguments)
				}
			};
			break;
		case "done":
			yield {
				type: "usage",
				usage: mapUsage(event.message.usage)
			};
			yield {
				type: "finish",
				reason: stopReason(event.message, contextWindow),
				replayState: toCodexReplayState(event.message)
			};
			return;
		case "error":
			yield {
				type: "usage",
				usage: mapUsage(event.error.usage)
			};
			yield {
				type: "finish",
				reason: stopReason(event.error, contextWindow)
			};
			return;
	}
	throw new LlmError("OpenAI Codex event stream closed without a terminal event.", "STREAM_CLOSED");
}
//#endregion
//#region src/adapter.ts
function assertProvider(provider) {
	if (provider !== "openai-codex") throw new LlmError(`OpenAI Codex adapter does not own provider "${provider}"`, "NO_ADAPTER");
}
function modelInfo(model) {
	return {
		provider: OPENAI_CODEX_PROVIDER,
		id: model.id,
		name: model.name,
		inputModalities: [...model.input]
	};
}
function reasoningLevels(model) {
	return getSupportedThinkingLevels(model).filter((level) => level !== "off");
}
function reasoningName(level) {
	return `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}
function resolveReasoning(model, requested) {
	if (requested === void 0) return void 0;
	const value = String(requested);
	if (reasoningLevels(model).some((level) => level === value)) return value;
	throw new LlmError(`OpenAI Codex model "${model.id}" does not support reasoning effort "${value}"`, "UNSUPPORTED_REASONING_EFFORT");
}
function transformHeaders(headers) {
	const attribution = attributionHeaders();
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	return {
		...Object.fromEntries(Object.entries(headers).filter(([name]) => !reserved.has(name.toLowerCase()))),
		...attribution
	};
}
/** Route-specific adapter over the plugin-owned credential-aware model collection. */
var OpenAiCodexAdapter = class extends LlmAdapter {
	models;
	options;
	/**
	* @param models - plugin-owned OpenAI Codex model collection.
	* @param options - optional Harness capability resolvers.
	*/
	constructor(models, options = {}) {
		super();
		this.models = models;
		this.options = options;
	}
	providerInfo(provider) {
		assertProvider(provider);
		return {
			id: provider,
			name: "OpenAI Codex (ChatGPT OAuth)"
		};
	}
	async listModels(provider) {
		assertProvider(provider);
		return (await this.models.getModels(provider)).map(modelInfo);
	}
	resolveModel(provider, id) {
		return Promise.resolve().then(async () => {
			assertProvider(provider);
			const model = await this.models.getModel(provider, id);
			if (model === void 0) throw new LlmError(`OpenAI Codex has no model "${id}"`, "UNKNOWN_MODEL");
			const levels = reasoningLevels(model);
			return {
				...modelInfo(model),
				...model.contextWindow === void 0 ? {} : { context: { contextWindow: model.contextWindow } },
				...levels.length === 0 ? {} : { reasoning: { efforts: levels.map((level) => ({
					id: ReasoningEffortId(level),
					name: reasoningName(level)
				})) } }
			};
		});
	}
	async *stream(options) {
		assertProvider(options.provider);
		if (options.stop !== void 0) throw new LlmError("OpenAI Codex does not support Harness stop sequences.", "UNSUPPORTED_OPTION");
		if (options.maxTokens !== void 0) throw new LlmError("OpenAI Codex does not expose a per-request maxTokens option.", "UNSUPPORTED_OPTION");
		const model = await this.models.getModel(options.provider, options.model);
		if (model === void 0) throw new LlmError(`OpenAI Codex has no model "${options.model}"`, "UNKNOWN_MODEL");
		const reasoning = resolveReasoning(model, options.reasoningEffort);
		const containsImage = options.messages.some((message) => contentHasImage(message.content));
		if (containsImage && !model.input.includes("image")) throw new LlmError(`OpenAI Codex model "${model.id}" does not support image input.`, "UNSUPPORTED_CONTENT");
		if (options.signal?.aborted) throw new LlmError("OpenAI Codex request was aborted by the caller.", "ABORTED");
		const consumer = new AbortController();
		const signal = options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
		let iterator;
		let exhausted = false;
		try {
			const context = await toCodexContext(options, containsImage ? this.options.attachments?.() : void 0);
			iterator = toStreamChunks(this.models.streamSimple(model, context, {
				...reasoning === void 0 ? {} : { reasoning },
				...options.temperature === void 0 ? {} : { temperature: options.temperature },
				...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },
				signal,
				maxRetries: 0,
				transformHeaders
			}), model.contextWindow)[Symbol.asyncIterator]();
			while (true) {
				const next = await iterator.next();
				if (next.done) {
					exhausted = true;
					return;
				}
				yield next.value;
			}
		} catch (error) {
			if (error instanceof LlmError) throw error;
			if (options.signal?.aborted) throw new LlmError("OpenAI Codex request was aborted by the caller.", "ABORTED");
			throw redactedCodexError(error);
		} finally {
			if (!exhausted) {
				consumer.abort("OpenAI Codex stream consumer stopped");
				try {
					await iterator?.return?.();
				} catch {}
			}
			consumer.abort("OpenAI Codex stream consumer stopped");
		}
	}
};
//#endregion
//#region src/model-catalog.ts
/** Validate the Codex models endpoint without trusting response URLs or diagnostic text. */
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_CATALOG_CLIENT_VERSION = "0.166.0";
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid() {
	throw new LlmError("OpenAI Codex returned an invalid model catalog.", "PROTOCOL_ERROR");
}
function effort(value) {
	return typeof value === "string" && [
		"none",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"ultra"
	].includes(value);
}
/** Parse remote display and capability metadata; hidden models remain resolvable for history. */
function parseModelCatalog(value) {
	if (!record(value) || !Array.isArray(value["models"])) return invalid();
	const ids = /* @__PURE__ */ new Set();
	return value["models"].map((raw) => {
		if (!record(raw) || typeof raw["slug"] !== "string" || raw["slug"].length === 0 || typeof raw["display_name"] !== "string" || raw["display_name"].length === 0 || !["list", "hide"].includes(String(raw["visibility"])) || !Array.isArray(raw["supported_reasoning_levels"])) return invalid();
		const id = raw["slug"];
		if (ids.has(id)) return invalid();
		ids.add(id);
		const context = raw["context_window"] ?? raw["max_context_window"];
		if (context !== void 0 && (typeof context !== "number" || !Number.isSafeInteger(context) || context <= 0)) return invalid();
		const modalities = raw["input_modalities"] ?? ["text"];
		if (!Array.isArray(modalities) || !modalities.every((m) => typeof m === "string")) return invalid();
		const input = modalities.filter((m) => m === "text" || m === "image");
		if (input.length === 0) return invalid();
		const thinkingLevelMap = {};
		for (const level of raw["supported_reasoning_levels"]) {
			if (!record(level) || typeof level["effort"] !== "string") return invalid();
			if (effort(level["effort"])) thinkingLevelMap[level["effort"]] = level["effort"];
		}
		return {
			id,
			name: raw["display_name"],
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			input,
			thinkingLevelMap,
			reasoning: Object.keys(thinkingLevelMap).length > 0,
			hidden: raw["visibility"] !== "list",
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			...typeof context === "number" ? { contextWindow: context } : {}
		};
	});
}
//#endregion
//#region src/codex-models.ts
const REFRESH_SKEW_MS = 6e4;
const RESPONSES_PATH = "/codex/responses";
const MAX_SSE_BUFFER_CHARS = 16 * 1024 * 1024;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOf(value) {
	return typeof value === "string" ? value : void 0;
}
function numberOf(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
function outputMessage(model) {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: OPENAI_CODEX_PROVIDER,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now()
	};
}
function parseObject(value) {
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
function parsedSignature(value) {
	if (value === void 0) return void 0;
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
function resultOutput(content) {
	const text = content.filter((block) => block.type === "text").map((block) => block.text).join("");
	const images = content.filter((block) => block.type === "image");
	if (images.length === 0) return text || "(no output)";
	return [...text.length === 0 ? [] : [{
		type: "input_text",
		text
	}], ...images.map((image) => ({
		type: "input_image",
		detail: "auto",
		image_url: `data:${image.mimeType};base64,${image.data}`
	}))];
}
function inputOf(context) {
	const input = [];
	for (const [messageIndex, message] of context.messages.entries()) {
		if (message.role === "user") {
			const content = typeof message.content === "string" ? [{
				type: "input_text",
				text: message.content
			}] : message.content.map((block) => block.type === "text" ? {
				type: "input_text",
				text: block.text
			} : {
				type: "input_image",
				detail: "auto",
				image_url: `data:${block.mimeType};base64,${block.data}`
			});
			if (content.length > 0) input.push({
				role: "user",
				content
			});
			continue;
		}
		if (message.role === "toolResult") {
			input.push({
				type: "function_call_output",
				call_id: message.toolCallId.split("|", 1)[0],
				output: resultOutput(message.content)
			});
			continue;
		}
		for (const [blockIndex, block] of message.content.entries()) {
			if (block.type === "thinking") {
				const native = parsedSignature(block.thinkingSignature);
				if (native?.["type"] === "reasoning") input.push(native);
				continue;
			}
			if (block.type === "text") {
				const signature = parsedSignature(block.textSignature);
				input.push({
					type: "message",
					role: "assistant",
					status: "completed",
					id: stringOf(signature?.["id"]) ?? `msg_dsh_${messageIndex}_${blockIndex}`,
					content: [{
						type: "output_text",
						text: block.text,
						annotations: []
					}],
					...stringOf(signature?.["phase"]) === void 0 ? {} : { phase: stringOf(signature?.["phase"]) }
				});
				continue;
			}
			const [callId = "", itemId] = block.id.split("|", 2);
			input.push({
				type: "function_call",
				...itemId === void 0 || itemId.length === 0 ? {} : { id: itemId },
				call_id: callId,
				name: block.name,
				arguments: JSON.stringify(block.arguments)
			});
		}
	}
	return input;
}
function requestBody(model, context, options) {
	const body = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt || "You are a helpful assistant.",
		input: inputOf(context),
		text: { verbosity: "low" },
		include: ["reasoning.encrypted_content"],
		tool_choice: "auto",
		parallel_tool_calls: true
	};
	if (options.sessionId !== void 0) body["prompt_cache_key"] = options.sessionId;
	if (options.temperature !== void 0) body["temperature"] = options.temperature;
	if (context.tools !== void 0 && context.tools.length > 0) body["tools"] = context.tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: null
	}));
	if (options.reasoning !== void 0 && options.reasoning !== "off") {
		const effort = model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning;
		if (effort !== null) body["reasoning"] = {
			effort,
			summary: "auto"
		};
	}
	return body;
}
function requestHeaders(credential, options) {
	const required = {
		authorization: `Bearer ${credential.access}`,
		"chatgpt-account-id": credential.accountId,
		originator: "deepseek-harness",
		"user-agent": "dsh-openai-oauth/0.2.1",
		"openai-beta": "responses=experimental",
		accept: "text/event-stream",
		"content-type": "application/json"
	};
	const transformed = options.transformHeaders?.({}) ?? {};
	const headers = new Headers();
	for (const [name, value] of Object.entries(transformed)) if (value !== null) headers.set(name, value);
	for (const [name, value] of Object.entries(required)) headers.set(name, value);
	if (options.sessionId !== void 0) {
		headers.set("session-id", options.sessionId);
		headers.set("x-client-request-id", options.sessionId);
	}
	return headers;
}
function httpFailure(status) {
	if (status === 401 || status === 403) return new LlmError("OpenAI Codex authentication failed. Sign in again.", "AUTH");
	if (status === 429) return new LlmError("OpenAI Codex rate limit reached. Retry later.", "RATE_LIMIT");
	if (status === 408 || status === 504) return new LlmError("OpenAI Codex request timed out.", "TIMEOUT");
	return new LlmError("OpenAI Codex request failed.", "CODEX_ERROR");
}
async function* sse(response, signal) {
	if (response.body === null) throw new LlmError("OpenAI Codex returned no response body.", "TRANSPORT");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const abort = () => {
		reader.cancel().catch(() => void 0);
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			if (signal?.aborted) throw new LlmError("OpenAI Codex request was aborted.", "ABORTED");
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			if (buffer.length > MAX_SSE_BUFFER_CHARS) throw new LlmError("OpenAI Codex returned an oversized streaming event.", "PROTOCOL_ERROR");
			let separator = /\r?\n\r?\n/.exec(buffer);
			while (separator !== null) {
				const frame = buffer.slice(0, separator.index);
				buffer = buffer.slice(separator.index + separator[0].length);
				const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
				if (data.length > 0 && data !== "[DONE]") {
					let parsed;
					try {
						parsed = JSON.parse(data);
					} catch {
						throw new LlmError("OpenAI Codex returned invalid streaming data.", "PROTOCOL_ERROR");
					}
					if (!isRecord(parsed)) throw new LlmError("OpenAI Codex returned invalid streaming data.", "PROTOCOL_ERROR");
					yield parsed;
				}
				separator = /\r?\n\r?\n/.exec(buffer);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		await reader.cancel().catch(() => void 0);
		reader.releaseLock();
	}
}
function responseUsage(value) {
	if (!isRecord(value)) return emptyUsage();
	const input = numberOf(value["input_tokens"]) ?? 0;
	const output = numberOf(value["output_tokens"]) ?? 0;
	const details = isRecord(value["input_tokens_details"]) ? value["input_tokens_details"] : void 0;
	const outputDetails = isRecord(value["output_tokens_details"]) ? value["output_tokens_details"] : void 0;
	const cacheRead = numberOf(details?.["cached_tokens"]) ?? 0;
	const cacheWrite = numberOf(details?.["cache_write_tokens"]) ?? 0;
	const reasoning = numberOf(outputDetails?.["reasoning_tokens"]) ?? 0;
	return {
		input: Math.max(0, input - cacheRead - cacheWrite),
		output,
		cacheRead,
		cacheWrite,
		...reasoning === 0 ? {} : { reasoning },
		totalTokens: numberOf(value["total_tokens"]) ?? input + output,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
/** Credential-aware model collection and direct Codex Responses transport. */
var CodexModels = class {
	credentials;
	options;
	fetch;
	now;
	catalog;
	pending;
	/**
	* @param credentials - plugin-owned credential persistence.
	* @param options - direct HTTP and refresh operations.
	*/
	constructor(credentials, options) {
		this.credentials = credentials;
		this.options = options;
		this.fetch = options.fetch ?? globalThis.fetch;
		this.now = options.now ?? Date.now;
	}
	/** Refresh the account's visible catalog; concurrent requests share one fetch. Signed-out callers get no models. */
	async getModels(provider) {
		if (provider !== void 0 && provider !== "openai-codex") return [];
		if (await this.credentials.read("openai-codex") === void 0) {
			this.catalog = void 0;
			return [];
		}
		const credential = await this.credential();
		const identity = JSON.stringify([credential.accountId, credential.access]);
		if (this.pending?.identity === identity) return (await this.pending.promise).filter((model) => !model.hidden);
		const promise = this.fetchCatalog(credential).then(async (models) => {
			const latest = await this.credentials.read(OPENAI_CODEX_PROVIDER);
			if (latest === void 0 || latest.accountId !== credential.accountId || latest.access !== credential.access) return [];
			this.catalog = {
				identity,
				models
			};
			return models;
		});
		const pending = {
			identity,
			promise
		};
		this.pending = pending;
		try {
			return (await promise).filter((model) => !model.hidden);
		} finally {
			if (this.pending === pending) this.pending = void 0;
		}
	}
	/** Resolve metadata from the current account's most recent catalog, fetching it on first use. */
	async getModel(provider, id) {
		if (provider !== "openai-codex") return void 0;
		const credential = await this.credentials.read(OPENAI_CODEX_PROVIDER);
		const identity = credential === void 0 ? void 0 : JSON.stringify([credential.accountId, credential.access]);
		if (identity === void 0 || this.catalog?.identity !== identity) await this.getModels(provider);
		const latest = await this.credentials.read(OPENAI_CODEX_PROVIDER);
		const latestIdentity = latest === void 0 ? void 0 : JSON.stringify([latest.accountId, latest.access]);
		return latestIdentity === void 0 || this.catalog?.identity !== latestIdentity ? void 0 : this.catalog.models.find((model) => model.id === id);
	}
	async fetchCatalog(credential) {
		const headers = requestHeaders(credential, { transformHeaders: () => attributionHeaders() });
		headers.set("accept", "application/json");
		const signal = AbortSignal.timeout(1e4);
		try {
			const response = await this.fetch(`${CODEX_BASE_URL}/codex/models?client_version=${CODEX_CATALOG_CLIENT_VERSION}`, {
				method: "GET",
				headers,
				redirect: "error",
				signal
			});
			if (!response.ok) throw httpFailure(response.status);
			return parseModelCatalog(await response.json());
		} catch (error) {
			if (error instanceof LlmError) throw error;
			if (error instanceof SyntaxError) throw new LlmError("OpenAI Codex returned an invalid model catalog.", "PROTOCOL_ERROR");
			throw new LlmError("OpenAI Codex model discovery failed. Check the connection and refresh the model list.", signal.aborted ? "TIMEOUT" : "TRANSPORT");
		}
	}
	async credential(signal) {
		const current = await this.credentials.read(OPENAI_CODEX_PROVIDER);
		if (current === void 0) throw new LlmError("OpenAI Codex is not signed in. Sign in with Browser or Device Code.", "MISSING_CREDENTIAL");
		if (current.expires > this.now() + REFRESH_SKEW_MS) return current;
		const refreshed = await this.credentials.modify(OPENAI_CODEX_PROVIDER, async (latest) => {
			if (latest === void 0) throw new LlmError("OpenAI Codex is not signed in. Sign in with Browser or Device Code.", "MISSING_CREDENTIAL");
			if (latest.expires > this.now() + REFRESH_SKEW_MS) return latest;
			try {
				return await this.options.refresh(latest, signal);
			} catch {
				if (signal?.aborted) throw new LlmError("OpenAI Codex request was aborted.", "ABORTED");
				throw new LlmError("OpenAI Codex authentication failed. Sign in again.", "AUTH");
			}
		});
		if (refreshed === void 0) throw new LlmError("OpenAI Codex is not signed in. Sign in with Browser or Device Code.", "MISSING_CREDENTIAL");
		return refreshed;
	}
	/** Stream one request through the ChatGPT Codex Responses endpoint. */
	async *streamSimple(model, context, options = {}) {
		const credential = await this.credential(options.signal);
		const response = await this.fetch(`${model.baseUrl.replace(/\/$/, "")}${RESPONSES_PATH}`, {
			method: "POST",
			headers: requestHeaders(credential, options),
			body: JSON.stringify(requestBody(model, context, options)),
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
		if (!response.ok) throw httpFailure(response.status);
		const output = outputMessage(model);
		const slots = /* @__PURE__ */ new Map();
		yield {
			type: "start",
			partial: output
		};
		for await (const event of sse(response, options.signal)) {
			const type = stringOf(event["type"]);
			const outputIndex = numberOf(event["output_index"]);
			const item = isRecord(event["item"]) ? event["item"] : void 0;
			if (type === "response.created") {
				const id = stringOf((isRecord(event["response"]) ? event["response"] : void 0)?.["id"]);
				if (id !== void 0) output.responseId = id;
			} else if (type === "response.output_item.added" && outputIndex !== void 0 && item !== void 0) {
				const itemType = stringOf(item["type"]);
				const contentIndex = output.content.length;
				if (itemType === "reasoning") {
					output.content.push({
						type: "thinking",
						thinking: ""
					});
					slots.set(outputIndex, {
						kind: "thinking",
						contentIndex,
						arguments: ""
					});
					yield {
						type: "thinking_start",
						contentIndex,
						partial: output
					};
				} else if (itemType === "message") {
					output.content.push({
						type: "text",
						text: ""
					});
					slots.set(outputIndex, {
						kind: "text",
						contentIndex,
						arguments: ""
					});
					yield {
						type: "text_start",
						contentIndex,
						partial: output
					};
				} else if (itemType === "function_call") {
					const block = {
						type: "toolCall",
						id: `${stringOf(item["call_id"]) ?? ""}|${stringOf(item["id"]) ?? ""}`,
						name: stringOf(item["name"]) ?? "",
						arguments: {}
					};
					output.content.push(block);
					slots.set(outputIndex, {
						kind: "toolCall",
						contentIndex,
						arguments: stringOf(item["arguments"]) ?? ""
					});
					yield {
						type: "toolcall_start",
						contentIndex,
						partial: output
					};
				}
			} else if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && outputIndex !== void 0) {
				const slot = slots.get(outputIndex);
				const delta = stringOf(event["delta"]) ?? "";
				const block = slot === void 0 ? void 0 : output.content[slot.contentIndex];
				if (slot?.kind === "thinking" && block?.type === "thinking") {
					block.thinking += delta;
					yield {
						type: "thinking_delta",
						contentIndex: slot.contentIndex,
						delta,
						partial: output
					};
				}
			} else if ((type === "response.output_text.delta" || type === "response.refusal.delta") && outputIndex !== void 0) {
				const slot = slots.get(outputIndex);
				const delta = stringOf(event["delta"]) ?? "";
				const block = slot === void 0 ? void 0 : output.content[slot.contentIndex];
				if (slot?.kind === "text" && block?.type === "text") {
					block.text += delta;
					yield {
						type: "text_delta",
						contentIndex: slot.contentIndex,
						delta,
						partial: output
					};
				}
			} else if (type === "response.function_call_arguments.delta" && outputIndex !== void 0) {
				const slot = slots.get(outputIndex);
				const delta = stringOf(event["delta"]) ?? "";
				if (slot?.kind === "toolCall") {
					slot.arguments += delta;
					yield {
						type: "toolcall_delta",
						contentIndex: slot.contentIndex,
						delta,
						partial: output
					};
				}
			} else if (type === "response.output_item.done" && outputIndex !== void 0 && item !== void 0) {
				const slot = slots.get(outputIndex);
				const block = slot === void 0 ? void 0 : output.content[slot.contentIndex];
				if (slot?.kind === "thinking" && block?.type === "thinking") {
					const text = (Array.isArray(item["summary"]) ? item["summary"] : []).map((part) => isRecord(part) ? stringOf(part["text"]) ?? "" : "").join("\n\n");
					if (text.length > 0) block.thinking = text;
					block.thinkingSignature = JSON.stringify(item);
					yield {
						type: "thinking_end",
						contentIndex: slot.contentIndex,
						content: block.thinking,
						partial: output
					};
				} else if (slot?.kind === "text" && block?.type === "text") {
					const text = (Array.isArray(item["content"]) ? item["content"] : []).map((part) => isRecord(part) ? stringOf(part["text"]) ?? stringOf(part["refusal"]) ?? "" : "").join("");
					if (text.length > 0) block.text = text;
					block.textSignature = JSON.stringify({
						id: stringOf(item["id"]),
						phase: stringOf(item["phase"])
					});
					yield {
						type: "text_end",
						contentIndex: slot.contentIndex,
						content: block.text,
						partial: output
					};
				} else if (slot?.kind === "toolCall" && block?.type === "toolCall") {
					const argumentsText = stringOf(item["arguments"]) ?? (slot.arguments || "{}");
					block.id = `${stringOf(item["call_id"]) ?? block.id.split("|", 1)[0]}|${stringOf(item["id"]) ?? ""}`;
					block.name = stringOf(item["name"]) ?? block.name;
					block.arguments = parseObject(argumentsText);
					yield {
						type: "toolcall_end",
						contentIndex: slot.contentIndex,
						toolCall: block,
						partial: output
					};
				}
				slots.delete(outputIndex);
			} else if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
				const terminal = isRecord(event["response"]) ? event["response"] : {};
				const responseId = stringOf(terminal["id"]);
				if (responseId !== void 0) output.responseId = responseId;
				const responseModel = stringOf(terminal["model"]);
				if (responseModel !== void 0) output.responseModel = responseModel;
				output.usage = responseUsage(terminal["usage"]);
				const status = stringOf(terminal["status"]);
				if (status === "failed" || status === "cancelled") {
					output.stopReason = "error";
					output.errorMessage = "OpenAI Codex response failed.";
					yield {
						type: "error",
						reason: "error",
						error: output
					};
					return;
				}
				output.stopReason = status === "incomplete" || type === "response.incomplete" ? "length" : output.content.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
				yield {
					type: "done",
					reason: output.stopReason,
					message: output
				};
				return;
			} else if (type === "response.failed" || type === "error") {
				output.stopReason = "error";
				output.errorMessage = "OpenAI Codex response failed.";
				yield {
					type: "error",
					reason: "error",
					error: output
				};
				return;
			}
		}
		throw new LlmError("OpenAI Codex event stream closed without a terminal event.", "STREAM_CLOSED");
	}
};
//#endregion
//#region src/protocol.ts
/** Exact local route family owned by this plugin. */
const OAUTH_ROUTE_PATH = "/api/plugins/openai-oauth";
//#endregion
//#region src/oauth-http.ts
const MAX_BODY_BYTES = 4096;
var HttpError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
};
/** Return true only for literal IPv4, mapped IPv4, or IPv6 loopback addresses. */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	if (address === "::1") return true;
	const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
	return isIP(ipv4) === 4 && ipv4.startsWith("127.");
}
function localHostname(hostname) {
	const plain = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	return plain === "localhost" || isLoopbackAddress(plain);
}
function authority(req) {
	if (!isLoopbackAddress(req.socket.remoteAddress)) return void 0;
	const host = req.headers.host;
	if (host === void 0) return void 0;
	try {
		const value = new URL(`http://${host}`);
		if (!localHostname(value.hostname) || value.username.length > 0 || value.password.length > 0) return void 0;
		return value;
	} catch {
		return;
	}
}
function mutationTrusted(req, host) {
	if (req.headers["sec-fetch-site"] !== "same-origin") return false;
	const origin = req.headers.origin;
	if (origin === void 0) return false;
	try {
		return new URL(origin).origin === host.origin;
	} catch {
		return false;
	}
}
function writeJson(res, status, body, headers = {}) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
		...headers
	});
	res.end(JSON.stringify(body));
}
function errorBody(error) {
	return { error: {
		code: error.code,
		message: error.message
	} };
}
function mappedControllerError(error) {
	switch (error.code) {
		case "INVALID_LOGIN_METHOD":
		case "UNSAFE_CALLBACK_HOST": return new HttpError(400, error.code, error.message);
		case "AUTH_IN_PROGRESS":
		case "STALE_ATTEMPT": return new HttpError(409, error.code, error.message);
		case "AUTH_DISPOSED": return new HttpError(503, error.code, error.message);
		case "AUTH_CANCELLED": return new HttpError(409, error.code, error.message);
		default: return new HttpError(502, error.code, error.message);
	}
}
function contentTypeIsJson(req) {
	const header = req.headers["content-type"];
	if (typeof header !== "string") return false;
	return header.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
async function readJson(req) {
	if (!contentTypeIsJson(req)) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "OAuth mutations require application/json.");
	const declared = req.headers["content-length"];
	if (declared !== void 0) {
		const bytes = Number(declared);
		if (!Number.isSafeInteger(bytes) || bytes < 0) throw new HttpError(400, "INVALID_BODY", "Invalid JSON request body.");
		if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "OAuth request body is too large.");
	}
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_BODY_BYTES) {
			req.resume();
			throw new HttpError(413, "BODY_TOO_LARGE", "OAuth request body is too large.");
		}
		chunks.push(buffer);
	}
	let value;
	try {
		value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpError(400, "INVALID_BODY", "Invalid JSON request body.");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "JSON request body must be an object.");
	return value;
}
function exactKeys(value, keys) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function startMethod(body) {
	if (!exactKeys(body, ["method"]) || body["method"] !== "browser" && body["method"] !== "device_code") throw new HttpError(400, "INVALID_LOGIN_METHOD", "Login method must be browser or device_code.");
	return body["method"];
}
function attemptId(body) {
	if (!exactKeys(body, ["attemptId"]) || typeof body["attemptId"] !== "string" || body["attemptId"].length === 0 || body["attemptId"].length > 200) throw new HttpError(400, "INVALID_ATTEMPT_ID", "A current OAuth attempt id is required.");
	return body["attemptId"];
}
/** Build the local-only OAuth route without registering it. */
function oauthRoute(controller) {
	return {
		kind: "prefix",
		path: OAUTH_ROUTE_PATH,
		handler: async (req, res) => {
			const host = authority(req);
			if (host === void 0) {
				writeJson(res, 403, errorBody(new HttpError(403, "LOCAL_ONLY", "OpenAI OAuth controls are available only from the local Harness Web Host.")));
				return;
			}
			const path = new URL(req.url ?? "/", host).pathname;
			if (req.method === "POST" && !mutationTrusted(req, host)) {
				writeJson(res, 403, errorBody(new HttpError(403, "SAME_ORIGIN_REQUIRED", "OAuth mutations require the local Harness origin.")));
				return;
			}
			try {
				if (path === `/api/plugins/openai-oauth/status`) {
					if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only GET.");
					writeJson(res, 200, await controller.status());
					return;
				}
				if (path === `/api/plugins/openai-oauth/start`) {
					if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only POST.");
					writeJson(res, 200, await controller.start(startMethod(await readJson(req))));
					return;
				}
				if (path === `/api/plugins/openai-oauth/cancel`) {
					if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only POST.");
					writeJson(res, 200, await controller.cancel(attemptId(await readJson(req))));
					return;
				}
				if (path === `/api/plugins/openai-oauth/logout`) {
					if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only POST.");
					if (!exactKeys(await readJson(req), [])) throw new HttpError(400, "INVALID_BODY", "Logout request body must be empty.");
					writeJson(res, 200, await controller.logout());
					return;
				}
				throw new HttpError(404, "NOT_FOUND", "OAuth endpoint not found.");
			} catch (error) {
				const mapped = error instanceof HttpError ? error : error instanceof AuthControllerError ? mappedControllerError(error) : new HttpError(500, "OAUTH_INTERNAL_ERROR", "OpenAI OAuth operation failed.");
				writeJson(res, mapped.status, errorBody(mapped), mapped.status === 405 ? { allow: path.endsWith("/status") ? "GET" : "POST" } : {});
			}
		}
	};
}
//#endregion
//#region src/index.ts
/** Cordis plugin identity. */
const name = "llm-openai-oauth";
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
const inject = ["llm"];
/** Construct the shared credential, OAuth, model, and adapter runtime. */
function createPluginRuntime(options = {}) {
	const credentials = new SecureCredentialStore(resolveDshHome(options.dshHome));
	const oauth = createOpenAiOAuth();
	const models = new CodexModels(credentials, { refresh: (credential, signal) => oauth.refresh(credential, signal) });
	return {
		credentials,
		models,
		controller: new AuthController(credentials, { login: options.login ?? ((interaction) => oauth.login(interaction)) }),
		adapter: new OpenAiCodexAdapter(models, { ...options.attachments === void 0 ? {} : { attachments: options.attachments } })
	};
}
/** Refuse the unsupported remotely reachable Web posture at plugin load. */
function assertLocalWebHost(host) {
	if (host !== "127.0.0.1") throw new Error("dsh-openai-oauth: Web OAuth supports only a loopback Host bound to 127.0.0.1");
}
/** Register the direct adapter and activate the local route whenever a Web Host is present. */
function apply(ctx) {
	const runtime = createPluginRuntime({ attachments: () => ctx.get("attachments") });
	ctx.effect(() => {
		const disposeAdapter = ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], runtime.adapter);
		return async () => {
			disposeAdapter();
			await runtime.controller.dispose();
		};
	}, "dsh-openai-oauth: adapter and controller");
	ctx.inject(["webServer"], (routeCtx) => {
		assertLocalWebHost(routeCtx.webServer.host);
		return routeCtx.webServer.register(oauthRoute(runtime.controller));
	});
}
//#endregion
export { AuthController, AuthControllerError, CredentialStoreError, OAUTH_ROUTE_PATH, OPENAI_CODEX_PROVIDER, OpenAiCodexAdapter, SecureCredentialStore, apply, assertLocalWebHost, createOpenAiOAuth, createPluginRuntime, inject, name };
