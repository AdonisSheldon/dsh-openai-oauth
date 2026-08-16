import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders, contentHasImage } from "@deepseek-ai/dsh-llm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { createServer } from "node:http";
import { isIP } from "node:net";
//#region src/models.ts
/** Return the selectable reasoning levels declared by one model. */
function getSupportedThinkingLevels(model) {
	return [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	].filter((level) => model.thinkingLevelMap?.[level] !== null && model.thinkingLevelMap?.[level] !== void 0);
}
const BASE_MODEL = {
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0
	},
	maxTokens: 128e3
};
/** Versioned model catalog shipped with this plugin release. */
const OPENAI_CODEX_MODELS = [
	{
		...BASE_MODEL,
		id: "gpt-5.3-codex-spark",
		name: "GPT-5.3 Codex Spark",
		input: ["text"],
		contextWindow: 128e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.4",
		name: "GPT-5.4",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.4-mini",
		name: "GPT-5.4 mini",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.5",
		name: "GPT-5.5",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.6-luna",
		name: "GPT-5.6 Luna",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.6-sol",
		name: "GPT-5.6 Sol",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max"
		}
	},
	{
		...BASE_MODEL,
		id: "gpt-5.6-terra",
		name: "GPT-5.6 Terra",
		input: ["text", "image"],
		contextWindow: 272e3,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max"
		}
	}
];
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
		kind: "openai-codex",
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
	if (state["kind"] !== "openai-codex" || state["version"] !== 1) return invalidReplay("unsupported kind or version");
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
		usage: emptyUsage$1(),
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
		usage: emptyUsage$1(),
		stopReason: state.stopReason,
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
/** Convert the complete Harness request into one fresh Codex context. */
async function toCodexContext(options, attachments) {
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
			const assistant = toCodexAssistant(message);
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
/** The single provider owned by this plugin. */
const OPENAI_CODEX_PROVIDER = "openai-codex";
const ENVELOPE_VERSION = 1;
const STATE_DIRECTORY_NAME = "dsh-openai-oauth";
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
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys$1(value, expected) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function parseCredential(value) {
	if (!isRecord$2(value) || !exactKeys$1(value, [
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
	if (!isRecord$2(value) || !exactKeys$1(value, ["version", "credentials"]) || value["version"] !== ENVELOPE_VERSION) throw invalidCredentialFile();
	const credentials = value["credentials"];
	if (!isRecord$2(credentials) || !Object.keys(credentials).every((key) => key === "openai-codex")) throw invalidCredentialFile();
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
	return isRecord$2(error) && error["code"] === "ENOENT";
}
/**
* Owner-only, versioned OAuth credential store rooted below one Harness home.
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
* while the OAuth service owns the OpenAI protocol and token exchange.
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
	* @param credentials - plugin-owned persistent OAuth credential store.
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
//#region src/codex-models.ts
const REFRESH_SKEW_MS = 6e4;
const RESPONSES_PATH = "/codex/responses";
const MAX_SSE_BUFFER_CHARS = 16 * 1024 * 1024;
function isRecord$1(value) {
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
		return isRecord$1(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
function parsedSignature(value) {
	if (value === void 0) return void 0;
	try {
		const parsed = JSON.parse(value);
		return isRecord$1(parsed) ? parsed : void 0;
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
		"user-agent": "dsh-openai-oauth/0.1.0",
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
					if (!isRecord$1(parsed)) throw new LlmError("OpenAI Codex returned invalid streaming data.", "PROTOCOL_ERROR");
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
	if (!isRecord$1(value)) return emptyUsage();
	const input = numberOf(value["input_tokens"]) ?? 0;
	const output = numberOf(value["output_tokens"]) ?? 0;
	const details = isRecord$1(value["input_tokens_details"]) ? value["input_tokens_details"] : void 0;
	const outputDetails = isRecord$1(value["output_tokens_details"]) ? value["output_tokens_details"] : void 0;
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
	/** Return models from the plugin's versioned catalog. */
	getModels(provider) {
		return provider === void 0 || provider === "openai-codex" ? OPENAI_CODEX_MODELS : [];
	}
	/** Resolve one exact model owned by the provider route. */
	getModel(provider, id) {
		return provider === "openai-codex" ? OPENAI_CODEX_MODELS.find((model) => model.id === id) : void 0;
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
			const item = isRecord$1(event["item"]) ? event["item"] : void 0;
			if (type === "response.created") {
				const id = stringOf((isRecord$1(event["response"]) ? event["response"] : void 0)?.["id"]);
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
					const text = (Array.isArray(item["summary"]) ? item["summary"] : []).map((part) => isRecord$1(part) ? stringOf(part["text"]) ?? "" : "").join("\n\n");
					if (text.length > 0) block.thinking = text;
					block.thinkingSignature = JSON.stringify(item);
					yield {
						type: "thinking_end",
						contentIndex: slot.contentIndex,
						content: block.thinking,
						partial: output
					};
				} else if (slot?.kind === "text" && block?.type === "text") {
					const text = (Array.isArray(item["content"]) ? item["content"] : []).map((part) => isRecord$1(part) ? stringOf(part["text"]) ?? stringOf(part["refusal"]) ?? "" : "").join("");
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
				const terminal = isRecord$1(event["response"]) ? event["response"] : {};
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
//#region src/openai-oauth.ts
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const BROWSER_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1455;
const DEVICE_TIMEOUT_SECONDS = 900;
const SCOPE = "openid profile email offline_access";
const ACCOUNT_CLAIM = "https://api.openai.com/auth";
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cancelled(signal) {
	if (signal?.aborted) throw new Error("Login cancelled");
}
function defaultSleep(milliseconds, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(/* @__PURE__ */ new Error("Login cancelled"));
			return;
		}
		const complete = () => {
			signal?.removeEventListener("abort", abort);
			resolve();
		};
		const abort = () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("Login cancelled"));
		};
		const timer = setTimeout(complete, milliseconds);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
	});
}
function accountIdOf(token) {
	try {
		const payload = token.split(".")[1];
		if (payload === void 0) return void 0;
		const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (!isRecord(decoded)) return void 0;
		const auth = decoded[ACCOUNT_CLAIM];
		if (!isRecord(auth)) return void 0;
		const accountId = auth["chatgpt_account_id"];
		return typeof accountId === "string" && accountId.length > 0 ? accountId : void 0;
	} catch {
		return;
	}
}
async function readJson$1(response, operation) {
	if (!response.ok) throw new Error(`OpenAI OAuth ${operation} failed with status ${response.status}.`);
	const value = await response.json().catch(() => void 0);
	if (!isRecord(value)) throw new Error(`OpenAI OAuth ${operation} returned invalid JSON.`);
	return value;
}
function credentialFromToken(value, now) {
	const access = value["access_token"];
	const refresh = value["refresh_token"];
	const expiresIn = value["expires_in"];
	if (typeof access !== "string" || access.length === 0 || typeof refresh !== "string" || refresh.length === 0 || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("OpenAI OAuth token response is missing required fields.");
	const accountId = accountIdOf(access);
	if (accountId === void 0) throw new Error("OpenAI OAuth access token has no valid account claim.");
	return {
		type: "oauth",
		access,
		refresh,
		expires: now + expiresIn * 1e3,
		accountId
	};
}
function successPage() {
	return "<!doctype html><meta charset=\"utf-8\"><title>OpenAI sign-in complete</title><p>OpenAI sign-in completed. You can close this window.</p>";
}
function errorPage(message) {
	return `<!doctype html><meta charset="utf-8"><title>OpenAI sign-in failed</title><p>${message}</p>`;
}
/** Wait for one state-bound OAuth callback on the fixed loopback listener. */
function waitForLoopbackCallback(state, signal) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (operation) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			server.close();
			operation();
		};
		const abort = () => {
			settle(() => {
				reject(/* @__PURE__ */ new Error("Login cancelled"));
			});
		};
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", "http://localhost");
			response.setHeader("content-type", "text/html; charset=utf-8");
			response.setHeader("cache-control", "no-store");
			if (url.pathname !== "/auth/callback") {
				response.statusCode = 404;
				response.end(errorPage("Callback route not found."));
				return;
			}
			if (url.searchParams.get("state") !== state) {
				response.statusCode = 400;
				response.end(errorPage("State mismatch."));
				return;
			}
			const code = url.searchParams.get("code");
			if (code === null || code.length === 0) {
				response.statusCode = 400;
				response.end(errorPage("Missing authorization code."));
				return;
			}
			response.statusCode = 200;
			response.end(successPage());
			settle(() => {
				resolve(code);
			});
		});
		server.once("error", (error) => {
			settle(() => {
				reject(error);
			});
		});
		server.listen(CALLBACK_PORT, CALLBACK_HOST);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
	});
}
async function exchange(fetch, code, verifier, redirectUri, now, signal) {
	cancelled(signal);
	return credentialFromToken(await readJson$1(await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri
		}),
		...signal === void 0 ? {} : { signal }
	}), "token exchange"), now());
}
/** Create the plugin-owned OpenAI OAuth implementation. */
function createOpenAiOAuth(options = {}) {
	const fetch = options.fetch ?? globalThis.fetch;
	const now = options.now ?? Date.now;
	const randomBytes$1 = options.randomBytes ?? randomBytes;
	const sleep = options.sleep ?? defaultSleep;
	const waitForCallback = options.waitForCallback ?? waitForLoopbackCallback;
	const browser = async (interaction) => {
		const verifier = Buffer.from(randomBytes$1(32)).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const state = Buffer.from(randomBytes$1(16)).toString("hex");
		const authorization = new URL(AUTHORIZE_URL);
		authorization.search = new URLSearchParams({
			response_type: "code",
			client_id: CLIENT_ID,
			redirect_uri: BROWSER_REDIRECT_URI,
			scope: SCOPE,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "deepseek-harness"
		}).toString();
		const callback = waitForCallback(state, interaction.signal);
		interaction.notify({
			type: "auth_url",
			url: authorization.toString(),
			instructions: "Complete OpenAI sign-in in the browser."
		});
		return exchange(fetch, await callback, verifier, BROWSER_REDIRECT_URI, now, interaction.signal);
	};
	const device = async (interaction) => {
		cancelled(interaction.signal);
		const value = await readJson$1(await fetch(DEVICE_USER_CODE_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_id: CLIENT_ID }),
			...interaction.signal === void 0 ? {} : { signal: interaction.signal }
		}), "device-code request");
		const deviceAuthId = value["device_auth_id"];
		const userCode = value["user_code"];
		const rawInterval = value["interval"];
		const intervalSeconds = typeof rawInterval === "string" ? Number(rawInterval) : rawInterval;
		if (typeof deviceAuthId !== "string" || deviceAuthId.length === 0 || typeof userCode !== "string" || userCode.length === 0 || typeof intervalSeconds !== "number" || !Number.isFinite(intervalSeconds) || intervalSeconds < 0) throw new Error("OpenAI OAuth device-code response is invalid.");
		interaction.notify({
			type: "device_code",
			userCode,
			verificationUri: DEVICE_VERIFICATION_URI,
			intervalSeconds,
			expiresInSeconds: DEVICE_TIMEOUT_SECONDS
		});
		const deadline = now() + DEVICE_TIMEOUT_SECONDS * 1e3;
		let pollDelay = Math.max(1e3, intervalSeconds * 1e3);
		while (now() <= deadline) {
			await sleep(pollDelay, interaction.signal);
			cancelled(interaction.signal);
			const response = await fetch(DEVICE_TOKEN_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					device_auth_id: deviceAuthId,
					user_code: userCode
				}),
				...interaction.signal === void 0 ? {} : { signal: interaction.signal }
			});
			if (response.ok) {
				const token = await readJson$1(response, "device authorization");
				const code = token["authorization_code"];
				const verifier = token["code_verifier"];
				if (typeof code !== "string" || code.length === 0 || typeof verifier !== "string" || verifier.length === 0) throw new Error("OpenAI OAuth device authorization response is invalid.");
				return exchange(fetch, code, verifier, DEVICE_REDIRECT_URI, now, interaction.signal);
			}
			if (response.status === 403 || response.status === 404) continue;
			const pending = await response.json().catch(() => void 0);
			const error = isRecord(pending) ? pending["error"] : void 0;
			const code = typeof error === "string" ? error : isRecord(error) ? error["code"] : void 0;
			if (code === "deviceauth_authorization_pending") continue;
			if (code === "slow_down") {
				pollDelay += 5e3;
				continue;
			}
			throw new Error(`OpenAI OAuth device authorization failed with status ${response.status}.`);
		}
		throw new Error("OpenAI OAuth device code expired.");
	};
	return {
		async login(interaction) {
			const method = await interaction.prompt({
				type: "select",
				message: "Select OpenAI login method:",
				options: [{
					id: "browser",
					label: "Browser login"
				}, {
					id: "device_code",
					label: "Device Code login"
				}]
			});
			if (method === "browser") return browser(interaction);
			if (method === "device_code") return device(interaction);
			throw new Error("Unknown OpenAI login method.");
		},
		async refresh(credential, signal) {
			cancelled(signal);
			return credentialFromToken(await readJson$1(await fetch(TOKEN_URL, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: credential.refresh,
					client_id: CLIENT_ID
				}),
				...signal === void 0 ? {} : { signal }
			}), "token refresh"), now());
		}
	};
}
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
export { name as a, AuthController as c, CredentialStoreError as d, OPENAI_CODEX_PROVIDER as f, inject as i, AuthControllerError as l, assertLocalWebHost as n, OAUTH_ROUTE_PATH as o, SecureCredentialStore as p, createPluginRuntime as r, createOpenAiOAuth as s, apply as t, OpenAiCodexAdapter as u };
