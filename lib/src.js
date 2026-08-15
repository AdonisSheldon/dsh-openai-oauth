import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createModels, getSupportedThinkingLevels, isContextOverflow } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders, contentHasImage } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { isIP } from "node:net";
//#region src/replay.ts
/**
* Lossless pi-ai assistant replay derived from the MIT-licensed
* `@deepseek-ai/dsh-llm-pi-ai` implementation.
*/
function parseArguments(raw) {
	try {
		const value = JSON.parse(raw);
		if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
	} catch {}
	return {};
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
/** Project a completed pi-ai response into durable JSON replay metadata. */
function toPiReplayState(message) {
	return {
		kind: "pi-ai",
		version: 1,
		api: message.api,
		provider: message.provider,
		model: message.model,
		...message.responseModel === void 0 ? {} : { responseModel: message.responseModel },
		...message.responseId === void 0 ? {} : { responseId: message.responseId },
		stopReason: message.stopReason,
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
	if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidReplay("expected an object");
	const state = value;
	if (state["kind"] !== "pi-ai" || state["version"] !== 1) return invalidReplay("unsupported kind or version");
	for (const key of [
		"api",
		"provider",
		"model"
	]) if (typeof state[key] !== "string" || state[key].length === 0) return invalidReplay(`${key} must be a non-empty string`);
	if (![
		"stop",
		"length",
		"toolUse",
		"error",
		"aborted"
	].includes(String(state["stopReason"]))) return invalidReplay("unknown stop reason");
	if (state["responseModel"] !== void 0 && typeof state["responseModel"] !== "string") return invalidReplay("responseModel must be a string");
	if (state["responseId"] !== void 0 && typeof state["responseId"] !== "string") return invalidReplay("responseId must be a string");
	if (!Array.isArray(state["blocks"])) return invalidReplay("blocks must be an array");
	for (const [index, value] of state["blocks"].entries()) {
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
	return state;
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
		usage: emptyUsage(),
		stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
		timestamp: 0
	};
}
function replayedAssistant(message, source, raw) {
	const state = readReplayState(raw);
	if (state.provider !== source.provider || state.model !== source.model) return invalidReplay("provider or model does not match source");
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
		api: state.api,
		provider: state.provider,
		model: state.model,
		...state.responseModel === void 0 ? {} : { responseModel: state.responseModel },
		...state.responseId === void 0 ? {} : { responseId: state.responseId },
		usage: emptyUsage(),
		stopReason: state.stopReason,
		timestamp: 0
	};
}
/** Reconstruct one pi-ai assistant history message from Harness content. */
function toPiAssistant(message) {
	const source = message.source;
	return source.kind === "model" && source.replayState !== void 0 ? replayedAssistant(message, source, source.replayState) : foreignAssistant(message);
}
//#endregion
//#region src/context.ts
/** Harness-to-pi-ai request conversion derived from MIT-licensed DeepSeek Harness. */
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
			if (attachments === void 0) throw new LlmError("OpenAI Codex image input requires the Harness attachment service", "UNSUPPORTED_CONTENT");
			const stored = await attachments.readImage(block.attachment, signal);
			content.push({
				type: "image",
				data: Buffer.from(stored.data).toString("base64"),
				mimeType: stored.ref.mediaType
			});
			break;
		}
		case "tool-result": {
			const nested = await userContent(block.content, attachments, signal);
			if (typeof nested === "string") {
				if (nested.length > 0) content.push({
					type: "text",
					text: nested
				});
			} else content.push(...nested);
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
/** Convert the complete Harness request into one fresh pi-ai context. */
async function toPiContext(options, attachments) {
	const toolNames = /* @__PURE__ */ new Map();
	const messages = [];
	for (const message of options.messages) {
		if (message.role === "system") {
			if (message.content.some((block) => block.type !== "text")) unsupported("non-text", "system");
			messages.push({
				role: "user",
				content: message.content.map((block) => block.type === "text" ? block.text : "").join(""),
				timestamp: 0
			});
			continue;
		}
		if (message.role === "assistant") {
			const assistant = toPiAssistant(message);
			for (const block of assistant.content) if (block.type === "toolCall") toolNames.set(CallId(block.id), block.name);
			messages.push(assistant);
			continue;
		}
		const content = await userContent(message.content.filter((block) => block.type !== "tool-result"), attachments, options.signal);
		const results = message.content.filter((block) => block.type === "tool-result");
		if ((typeof content === "string" ? content.length > 0 : content.length > 0) || results.length === 0) messages.push({
			role: "user",
			content,
			timestamp: 0
		});
		for (const result of results) {
			const resultContent = await userContent(result.content, attachments, options.signal);
			messages.push({
				role: "toolResult",
				toolCallId: result.toolCallId,
				toolName: toolNames.get(result.toolCallId) ?? "unknown",
				content: typeof resultContent === "string" ? [{
					type: "text",
					text: resultContent || "(no output)"
				}] : resultContent,
				isError: result.isError ?? false,
				timestamp: 0
			});
		}
	}
	const tools = toolsOf(options);
	return {
		...options.system === void 0 ? {} : { systemPrompt: options.system },
		messages,
		...tools !== void 0 && tools.length > 0 ? { tools } : {}
	};
}
//#endregion
//#region src/credential-store.ts
/** The single pi-ai provider owned by this plugin. */
const OPENAI_CODEX_PROVIDER = "openai-codex";
const ENVELOPE_VERSION = 1;
const STATE_DIRECTORY_NAME = "dsh-openai-codex-oauth";
const CREDENTIAL_FILE_NAME = "credentials.json";
/** Stable storage failure with no credential or file contents in its message. */
var CredentialStoreError = class extends Error {
	code;
	/**
	* @param code - stable diagnostic code safe to expose after route mapping.
	* @param message - fixed, redacted diagnostic text.
	*/
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "CredentialStoreError";
	}
};
function invalidCredentialFile() {
	return new CredentialStoreError("INVALID_CREDENTIAL_FILE", "OpenAI Codex credential file is invalid; log out or remove the plugin credential file and sign in again.");
}
function unsafePath() {
	return new CredentialStoreError("UNSAFE_CREDENTIAL_PATH", "OpenAI Codex credential storage uses an unsafe path; replace links with owner-only directories and retry.");
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys$1(value, expected) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function parseCredential(value) {
	if (!isRecord(value) || !exactKeys$1(value, [
		"type",
		"access",
		"refresh",
		"expires",
		"accountId"
	])) throw invalidCredentialFile();
	if (value["type"] !== "oauth" || typeof value["access"] !== "string" || value["access"].length === 0 || typeof value["refresh"] !== "string" || value["refresh"].length === 0 || typeof value["expires"] !== "number" || !Number.isFinite(value["expires"]) || value["expires"] <= 0 || typeof value["accountId"] !== "string" || value["accountId"].length === 0) throw invalidCredentialFile();
	return {
		type: "oauth",
		access: value["access"],
		refresh: value["refresh"],
		expires: value["expires"],
		accountId: value["accountId"]
	};
}
function parseEnvelope(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw invalidCredentialFile();
	}
	if (!isRecord(value) || !exactKeys$1(value, ["version", "credentials"]) || value["version"] !== ENVELOPE_VERSION) throw invalidCredentialFile();
	const credentials = value["credentials"];
	if (!isRecord(credentials) || !Object.keys(credentials).every((key) => key === "openai-codex")) throw invalidCredentialFile();
	const stored = credentials[OPENAI_CODEX_PROVIDER];
	return {
		version: ENVELOPE_VERSION,
		credentials: stored === void 0 ? {} : { [OPENAI_CODEX_PROVIDER]: parseCredential(stored) }
	};
}
function cloneCredential(credential) {
	return { ...credential };
}
function isMissing(error) {
	return isRecord(error) && error["code"] === "ENOENT";
}
/**
* Owner-only, versioned pi-ai credential store rooted below one Harness home.
* All writes and deletion are serialized by an OS-visible lock and replace the
* credential file atomically.
*/
var SecureCredentialStore = class {
	dshHome;
	/** Plugin-owned state directory. */
	stateDirectory;
	/** Versioned credential envelope path. */
	credentialFile;
	/**
	* @param dshHome - resolved Harness home directory.
	*/
	constructor(dshHome) {
		this.dshHome = dshHome;
		this.stateDirectory = resolve(dshHome, "plugins", STATE_DIRECTORY_NAME);
		this.credentialFile = join(this.stateDirectory, CREDENTIAL_FILE_NAME);
	}
	async assertDirectory(path, create) {
		let info;
		try {
			info = await lstat(path);
		} catch (error) {
			if (!isMissing(error) || !create) throw error;
			await mkdir(path, {
				recursive: true,
				mode: 448
			});
			info = await lstat(path);
		}
		if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePath();
		await chmod(path, 448);
	}
	async ensureStateDirectory() {
		await mkdir(this.dshHome, {
			recursive: true,
			mode: 448
		});
		const plugins = resolve(this.dshHome, "plugins");
		await this.assertDirectory(plugins, true);
		await this.assertDirectory(this.stateDirectory, true);
	}
	async readEnvelope() {
		let info;
		try {
			info = await lstat(this.credentialFile);
		} catch (error) {
			if (isMissing(error)) return void 0;
			throw error;
		}
		if (info.isSymbolicLink() || !info.isFile()) throw unsafePath();
		if ((info.mode & 63) !== 0) throw new CredentialStoreError("UNSAFE_CREDENTIAL_PERMISSIONS", "OpenAI Codex credential file permissions are unsafe; restrict the file to its owner and retry.");
		return parseEnvelope(await readFile(this.credentialFile, "utf8"));
	}
	async withLock(operation) {
		await this.ensureStateDirectory();
		const release = await lockfile.lock(this.stateDirectory, {
			realpath: false,
			stale: 3e4,
			update: 1e4,
			retries: {
				retries: 80,
				factor: 1.15,
				minTimeout: 10,
				maxTimeout: 150
			}
		});
		try {
			return await operation();
		} finally {
			await release();
		}
	}
	async writeCredential(credential) {
		const envelope = {
			version: ENVELOPE_VERSION,
			credentials: { [OPENAI_CODEX_PROVIDER]: cloneCredential(credential) }
		};
		const temporary = join(this.stateDirectory, `.${CREDENTIAL_FILE_NAME}.${randomUUID()}.tmp`);
		let handle;
		try {
			handle = await open(temporary, "wx", 384);
			await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
			await handle.sync();
			await handle.close();
			handle = void 0;
			await rename(temporary, this.credentialFile);
			await chmod(this.credentialFile, 384);
			if (process.platform !== "win32") {
				const directory = await open(this.stateDirectory, "r");
				try {
					await directory.sync();
				} finally {
					await directory.close();
				}
			}
		} finally {
			await handle?.close();
			try {
				await unlink(temporary);
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
		}
	}
	async read(providerId) {
		if (providerId !== "openai-codex") return void 0;
		await this.ensureStateDirectory();
		const stored = (await this.readEnvelope())?.credentials[OPENAI_CODEX_PROVIDER];
		return stored === void 0 ? void 0 : cloneCredential(stored);
	}
	async list() {
		const credential = await this.read(OPENAI_CODEX_PROVIDER);
		return credential === void 0 ? [] : [{
			providerId: OPENAI_CODEX_PROVIDER,
			type: credential.type
		}];
	}
	async modify(providerId, fn) {
		if (providerId !== "openai-codex") throw new CredentialStoreError("UNSUPPORTED_PROVIDER", "This credential store accepts only openai-codex.");
		return this.withLock(async () => {
			const current = (await this.readEnvelope())?.credentials[OPENAI_CODEX_PROVIDER];
			const replacement = await fn(current === void 0 ? void 0 : cloneCredential(current));
			if (replacement === void 0) return current === void 0 ? void 0 : cloneCredential(current);
			const validated = parseCredential(replacement);
			await this.writeCredential(validated);
			return cloneCredential(validated);
		});
	}
	async delete(providerId) {
		if (providerId !== "openai-codex") return;
		await this.withLock(async () => {
			const info = await lstat(this.credentialFile).catch((error) => {
				if (isMissing(error)) return void 0;
				throw error;
			});
			if (info === void 0) return;
			if (info.isSymbolicLink() || !info.isFile()) throw unsafePath();
			await unlink(this.credentialFile);
		});
	}
};
//#endregion
//#region src/stream.ts
/** pi-ai-to-Harness stream conversion derived from MIT-licensed DeepSeek Harness. */
/** Map pi-ai's disjoint usage fields into Harness usage. */
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
		code: "PI_AI_ERROR",
		message: "OpenAI Codex request failed."
	};
}
/** Convert a thrown pi-ai failure without retaining its message or cause. */
function redactedPiError(error) {
	const failure = providerFailure(error instanceof Error ? error.message : "");
	return new LlmError(failure.message, failure.code);
}
function stopReason(message, contextWindow) {
	if (isContextOverflow(message, contextWindow)) return {
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
/** Translate one pi-ai event stream into Harness chunks. */
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
				id: CallId(tool?.id ?? ""),
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
					id: CallId(event.toolCall.id),
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
				replayState: toPiReplayState(event.message)
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
/** Route-specific adapter over pi-ai's credential-aware Models collection. */
var OpenAiCodexAdapter = class extends LlmAdapter {
	models;
	options;
	/**
	* @param models - collection containing pi-ai's built-in openai-codex provider.
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
	listModels(provider) {
		return Promise.resolve().then(() => {
			assertProvider(provider);
			return this.models.getModels(provider).map(modelInfo);
		});
	}
	resolveModel(provider, id) {
		return Promise.resolve().then(() => {
			assertProvider(provider);
			const model = this.models.getModel(provider, id);
			if (model === void 0) throw new LlmError(`OpenAI Codex has no model "${id}"`, "UNKNOWN_MODEL");
			const levels = reasoningLevels(model);
			return {
				...modelInfo(model),
				context: { contextWindow: model.contextWindow },
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
		const model = this.models.getModel(options.provider, options.model);
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
			const context = await toPiContext(options, containsImage ? this.options.attachments?.() : void 0);
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
			throw redactedPiError(error);
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
//#region src/auth-controller.ts
/** Stable controller failure safe to translate at the local Host boundary. */
var AuthControllerError = class extends Error {
	code;
	/**
	* @param code - stable failure code.
	* @param message - fixed text containing no upstream error detail.
	*/
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "AuthControllerError";
	}
};
function cloneStatus(status) {
	if (status.state === "pending") return status.method === "browser" ? {
		...status,
		browser: { ...status.browser }
	} : {
		...status,
		deviceCode: { ...status.deviceCode }
	};
	if (status.state === "failed") return {
		...status,
		error: { ...status.error }
	};
	return { ...status };
}
function callbackHostIsLoopback(host) {
	if (host === "localhost" || host === "::1" || host === "[::1]") return true;
	const plain = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return isIP(plain) === 4 && plain.startsWith("127.");
}
function trustedOpenAiUrl(raw) {
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.hostname !== "auth.openai.com" || url.username.length > 0 || url.password.length > 0) return void 0;
		return url;
	} catch {
		return;
	}
}
function waitForAbort(signal) {
	return new Promise((_resolve, reject) => {
		const abort = () => {
			reject(new AuthControllerError("AUTH_CANCELLED", "OpenAI sign-in was cancelled."));
		};
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
	});
}
function redactedFailure(method, error) {
	const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
	const message = error instanceof Error ? error.message : "";
	if (method === "browser" && (code === "EADDRINUSE" || /EADDRINUSE|Missing authorization code/i.test(message))) return new AuthControllerError("BROWSER_CALLBACK_UNAVAILABLE", "Browser callback port 1455 is unavailable. Retry after freeing it or choose Device Code.");
	if (method === "device_code" && /expired|timed?\s*out/i.test(message)) return new AuthControllerError("DEVICE_CODE_EXPIRED", "The OpenAI device code expired. Start Device Code login again.");
	return new AuthControllerError("OAUTH_LOGIN_FAILED", "OpenAI sign-in failed. Retry or choose another login method.");
}
/**
* One dual-method OAuth state machine. It owns cancellation and persistence,
* while pi-ai owns the OpenAI protocol and token exchange.
*/
var AuthController = class {
	credentials;
	options;
	statusValue = { state: "disconnected" };
	active;
	latest;
	disposed = false;
	mutation = Promise.resolve();
	now;
	/**
	* @param credentials - plugin-owned persistent pi-ai credential store.
	* @param options - provider login operation and deterministic helpers.
	*/
	constructor(credentials, options) {
		this.credentials = credentials;
		this.options = options;
		this.now = options.now ?? Date.now;
	}
	/** Return a detached synchronous view containing no credential fields. */
	snapshot() {
		return cloneStatus(this.statusValue);
	}
	/** Reconcile the initial durable credential before returning redacted state. */
	async status() {
		if (this.active === void 0 && this.statusValue.state === "disconnected") {
			if (await this.credentials.read("openai-codex") !== void 0) this.statusValue = { state: "connected" };
		}
		return this.snapshot();
	}
	exclusive(operation) {
		const result = this.mutation.then(operation, operation);
		this.mutation = result.then(() => void 0, () => void 0);
		return result;
	}
	settleReady(attempt, outcome) {
		if (attempt.readySettled) return;
		attempt.readySettled = true;
		if (outcome instanceof AuthControllerError) attempt.rejectReady(outcome);
		else attempt.resolveReady(cloneStatus(outcome));
	}
	pendingFromEvent(attempt, event) {
		if (event.type === "info" || event.type === "progress") return void 0;
		if (event.type === "auth_url") {
			if (attempt.method !== "browser") throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in returned data for the wrong login method.");
			const url = trustedOpenAiUrl(event.url);
			if (url === void 0) throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in returned an invalid authorization URL.");
			return {
				state: "pending",
				attemptId: attempt.id,
				method: "browser",
				browser: {
					authorizationUrl: url.toString(),
					callback: "waiting"
				}
			};
		}
		if (attempt.method !== "device_code") throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in returned data for the wrong login method.");
		const verification = trustedOpenAiUrl(event.verificationUri);
		if (verification === void 0 || event.userCode.length === 0) throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in returned invalid device-code data.");
		const expiresInSeconds = event.expiresInSeconds ?? 900;
		if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in returned invalid device-code data.");
		return {
			state: "pending",
			attemptId: attempt.id,
			method: "device_code",
			deviceCode: {
				userCode: event.userCode,
				verificationUri: verification.toString(),
				expiresAt: this.now() + expiresInSeconds * 1e3
			}
		};
	}
	interaction(attempt) {
		return {
			signal: attempt.abort.signal,
			prompt: async (prompt) => {
				if (prompt.type === "select") return attempt.method;
				if (prompt.type === "manual_code") return waitForAbort(prompt.signal === void 0 ? attempt.abort.signal : AbortSignal.any([attempt.abort.signal, prompt.signal]));
				throw new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in requested an unsupported prompt.");
			},
			notify: (event) => {
				const status = this.pendingFromEvent(attempt, event);
				if (status === void 0 || attempt.winner !== void 0 || this.active !== attempt) return;
				attempt.publicStatus = status;
				this.statusValue = status;
				this.settleReady(attempt, status);
			}
		};
	}
	async run(attempt) {
		try {
			const credential = await this.options.login(this.interaction(attempt));
			if (attempt.winner !== void 0) return;
			attempt.winner = "complete";
			await this.credentials.modify(OPENAI_CODEX_PROVIDER, async () => credential);
			if (this.active === attempt) {
				this.active = void 0;
				this.statusValue = { state: "connected" };
			}
			if (attempt.publicStatus === void 0) this.settleReady(attempt, new AuthControllerError("OAUTH_PROTOCOL_ERROR", "OpenAI sign-in completed without presenting login instructions."));
		} catch (error) {
			if (attempt.winner === "cancel") {
				this.settleReady(attempt, new AuthControllerError("AUTH_CANCELLED", "OpenAI sign-in was cancelled."));
				return;
			}
			attempt.winner = "failure";
			const redacted = error instanceof AuthControllerError ? error : redactedFailure(attempt.method, error);
			if (this.active === attempt) {
				this.active = void 0;
				this.statusValue = {
					state: "failed",
					error: {
						code: redacted.code,
						message: redacted.message
					},
					connectedBeforeAttempt: attempt.connectedBefore
				};
			}
			this.settleReady(attempt, redacted);
		}
	}
	/** Start exactly the selected flow, returning once its public instructions exist. */
	async start(method) {
		return (await this.exclusive(async () => {
			if (this.disposed) throw new AuthControllerError("AUTH_DISPOSED", "OpenAI sign-in is unavailable because the plugin is stopping.");
			if (method !== "browser" && method !== "device_code") throw new AuthControllerError("INVALID_LOGIN_METHOD", "Login method must be browser or device_code.");
			if (method === "browser") {
				const callbackHost = process.env["PI_OAUTH_CALLBACK_HOST"];
				if (callbackHost !== void 0 && !callbackHostIsLoopback(callbackHost)) throw new AuthControllerError("UNSAFE_CALLBACK_HOST", "Browser login requires a loopback PI_OAUTH_CALLBACK_HOST. Choose Device Code for another machine.");
			}
			if (this.active !== void 0) {
				if (this.active.method !== method) throw new AuthControllerError("AUTH_IN_PROGRESS", "Another OpenAI login method is already in progress; cancel it first.");
				return { ready: this.active.ready };
			}
			const connectedBefore = await this.credentials.read(OPENAI_CODEX_PROVIDER) !== void 0;
			let resolveReady;
			let rejectReady;
			const ready = new Promise((resolve, reject) => {
				resolveReady = resolve;
				rejectReady = reject;
			});
			const attempt = {
				id: randomUUID(),
				method,
				connectedBefore,
				abort: new AbortController(),
				ready,
				resolveReady,
				rejectReady,
				readySettled: false,
				done: Promise.resolve()
			};
			this.active = attempt;
			this.latest = attempt;
			attempt.done = this.run(attempt);
			return { ready };
		})).ready;
	}
	/** Await completion of the latest named attempt for a direct headless caller. */
	async waitForAttempt(attemptId) {
		const attempt = this.latest;
		if (attempt === void 0 || attempt.id !== attemptId) throw new AuthControllerError("STALE_ATTEMPT", "The OpenAI login attempt is no longer current.");
		await attempt.done;
		return this.snapshot();
	}
	/** Cancel only the named current attempt and await provider cleanup. */
	async cancel(attemptId) {
		await await this.exclusive(async () => {
			const attempt = this.active;
			if (attempt === void 0 || attempt.id !== attemptId || attempt.winner !== void 0) throw new AuthControllerError("STALE_ATTEMPT", "The OpenAI login attempt is no longer active.");
			attempt.winner = "cancel";
			attempt.abort.abort("OpenAI sign-in cancelled");
			this.active = void 0;
			this.statusValue = attempt.connectedBefore ? { state: "connected" } : { state: "disconnected" };
			return attempt.done;
		});
		return this.snapshot();
	}
	/** Abort any attempt, then remove only the plugin-owned credential. */
	async logout() {
		const attempt = this.active;
		if (attempt !== void 0 && attempt.winner === void 0) await this.cancel(attempt.id);
		await this.credentials.delete(OPENAI_CODEX_PROVIDER);
		this.statusValue = { state: "disconnected" };
		return this.snapshot();
	}
	/** Abort and settle active provider work before plugin effects unwind. */
	async dispose() {
		this.disposed = true;
		await this.mutation;
		const attempt = this.active;
		if (attempt !== void 0 && attempt.winner === void 0) await this.cancel(attempt.id);
		else if (attempt !== void 0) await attempt.done;
	}
};
//#endregion
//#region src/protocol.ts
/** Exact local route family owned by this plugin. */
const OAUTH_ROUTE_PATH = "/api/plugins/openai-codex-oauth";
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
function oauthRoute(controller, listModels) {
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
				if (path === `/api/plugins/openai-codex-oauth/status`) {
					if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only GET.");
					const [status, models] = await Promise.all([controller.status(), listModels()]);
					writeJson(res, 200, {
						...status,
						models
					});
					return;
				}
				if (path === `/api/plugins/openai-codex-oauth/start`) {
					if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only POST.");
					writeJson(res, 200, await controller.start(startMethod(await readJson(req))));
					return;
				}
				if (path === `/api/plugins/openai-codex-oauth/cancel`) {
					if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This OAuth endpoint accepts only POST.");
					writeJson(res, 200, await controller.cancel(attemptId(await readJson(req))));
					return;
				}
				if (path === `/api/plugins/openai-codex-oauth/logout`) {
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
const name = "llm-openai-codex-oauth";
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
const inject = ["llm"];
function oauthOf(provider) {
	const oauth = provider.auth.oauth;
	if (oauth === void 0) throw new Error("openai-codex provider does not expose OAuth");
	return oauth;
}
/** Construct the shared credential, OAuth, model, and adapter runtime. */
function createPluginRuntime(options = {}) {
	const credentials = new SecureCredentialStore(resolveDshHome(options.dshHome));
	const models = createModels({ credentials });
	const provider = openaiCodexProvider();
	models.setProvider(provider);
	return {
		credentials,
		models,
		controller: new AuthController(credentials, { login: options.login ?? ((interaction) => oauthOf(provider).login(interaction)) }),
		adapter: new OpenAiCodexAdapter(models, { ...options.attachments === void 0 ? {} : { attachments: options.attachments } })
	};
}
/** Refuse the unsupported remotely reachable Web posture at plugin load. */
function assertLocalWebHost(host) {
	if (host !== "127.0.0.1") throw new Error("dsh-openai-codex-oauth: Web OAuth supports only a loopback Host bound to 127.0.0.1");
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
	}, "dsh-openai-codex-oauth: adapter and controller");
	ctx.inject(["webServer"], (routeCtx) => {
		assertLocalWebHost(routeCtx.webServer.host);
		return routeCtx.webServer.register(oauthRoute(runtime.controller, async () => (await runtime.adapter.listModels(OPENAI_CODEX_PROVIDER)).map((model) => ({
			id: model.id,
			name: model.name
		}))));
	});
}
//#endregion
export { name as a, AuthControllerError as c, OPENAI_CODEX_PROVIDER as d, SecureCredentialStore as f, inject as i, OpenAiCodexAdapter as l, assertLocalWebHost as n, OAUTH_ROUTE_PATH as o, createPluginRuntime as r, AuthController as s, apply as t, CredentialStoreError as u };
