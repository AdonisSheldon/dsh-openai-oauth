import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { createServer } from "node:http";
//#region node_modules/.pnpm/@deepseek-ai+dsh-home-paths@0.2.1-rc.5_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js
/**
* Shared filesystem path helpers for DeepSeek Harness user data.
*
* @module @deepseek-ai/dsh-home-paths
*/
/** Directory name for the default DeepSeek Harness home under the OS home. */
const DSH_HOME_DIR_NAME = ".dsh";
/** Environment variable that overrides the default DeepSeek Harness home. */
const DSH_HOME_ENV = "DSH_HOME";
/**
* Resolve the default DeepSeek Harness home using Node's platform path rules.
* @returns the absolute default harness home path.
*/
function defaultDshHome() {
	return join(homedir(), DSH_HOME_DIR_NAME);
}
/**
* Expand supported tilde prefixes against the operating-system home.
* @param path - configured path that may begin with `~`, `~/`, or `~\`.
* @returns the expanded path, or the original value when no supported prefix is present.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve one user-data root from an explicit path, an environment override, and a default.
* @param configured - explicit path, which has highest precedence.
* @param env - environment mapping to read.
* @param envName - environment variable that overrides the default.
* @param fallback - default root, used when neither the explicit path nor the environment provides one.
* @returns the normalized absolute root.
*/
function resolveRoot(configured, env, envName, fallback) {
	const fromEnv = env[envName];
	return resolve(expandHomePath(configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : fallback())));
}
/**
* Resolve the single-root DeepSeek Harness home.
*
* Precedence, highest first: an explicit configured path, `$DSH_HOME`, then
* `~/.dsh`. The harness keeps all user data under one root. An empty or
* whitespace-only `$DSH_HOME` is treated as unset, so a blank override never
* resolves the home to the current working directory.
* @param configured - explicit harness-home override, which has highest precedence.
* @param env - environment mapping used to read `DSH_HOME`.
* @returns the normalized absolute harness home path.
*/
function resolveDshHome(configured, env = process.env) {
	return resolveRoot(configured, env, DSH_HOME_ENV, defaultDshHome);
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
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value, expected) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function parseCredential(value) {
	if (!isRecord$1(value) || !exactKeys(value, [
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
	if (!isRecord$1(value) || !exactKeys(value, ["version", "credentials"]) || value["version"] !== ENVELOPE_VERSION) throw invalidCredentialFile();
	const credentials = value["credentials"];
	if (!isRecord$1(credentials) || !Object.keys(credentials).every((key) => key === "openai-codex")) throw invalidCredentialFile();
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
	return isRecord$1(error) && error["code"] === "ENOENT";
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
//#region src/brand-wordmark.ts
/** DeepSeek Harness wordmark paths copied from the host's BrandWordmark component. */
const BRAND_WORDMARK = `<svg class="brand-wordmark"
      width="182"
      height="24"
      viewBox="0 0 182 24"
      fill="none"
      aria-hidden="true" focusable="false"
    >
      <path d="M68.416 18.2447H67.0501V16.1272H68.416C69.2619 16.1272 70.1166 15.9163 70.6671 15.3304C71.2181 14.7444 71.426 13.8455 71.426 12.9471C71.426 12.0487 71.2268 11.1498 70.6671 10.5643C70.1083 9.97831 69.2619 9.76744 68.416 9.76744C67.5701 9.76744 66.7154 9.97831 66.1639 10.5643C65.6129 11.1503 65.4049 12.0487 65.4049 12.9471V21.6435H63.009V7.6582H65.4049V8.54883H65.8442C65.8918 8.49393 65.9394 8.44728 65.9875 8.40064C66.5871 7.85353 67.5049 7.6582 68.4072 7.6582C69.8212 7.6582 71.2341 8.00998 72.1607 8.98662C73.0868 9.96325 73.4143 11.4632 73.4143 12.9558C73.4143 14.4485 73.0785 15.9406 72.1607 16.925C71.2424 17.9094 69.8212 18.2457 68.416 18.2457V18.2447Z" fill="currentColor"/>
      <path d="M31.9551 8.03497H33.3204V10.1525H31.9551C31.1087 10.1525 30.2545 10.3633 29.7035 10.9493C29.1525 11.5353 28.945 12.4342 28.945 13.3326C28.945 14.231 29.1447 15.1294 29.7035 15.7154C30.2623 16.3014 31.1087 16.5122 31.9551 16.5122C32.8015 16.5122 33.6562 16.3014 34.2072 15.7154C34.7582 15.1294 34.9657 14.231 34.9657 13.3326V4.62842H37.3611V18.6219H34.9657V17.7313H34.5264C34.4783 17.7857 34.4307 17.8329 34.3826 17.8795C33.7835 18.4261 32.8652 18.6219 31.9629 18.6219C30.5494 18.6219 29.136 18.2707 28.2099 17.294C27.2838 16.3174 26.9563 14.817 26.9563 13.3248C26.9563 11.8327 27.2916 10.34 28.2099 9.35561C29.136 8.37898 30.5494 8.03497 31.9551 8.03497Z" fill="currentColor"/>
      <path d="M49.3786 13.1431V13.9948H42.9984V12.2996H47.2305C47.1348 11.6825 46.9113 11.1043 46.5119 10.682C45.9371 10.0727 45.0503 9.85409 44.1723 9.85409C43.2943 9.85409 42.4076 10.0727 41.8328 10.682C41.258 11.2913 41.05 12.2213 41.05 13.1435C41.05 14.0658 41.2575 15.003 41.8328 15.6046C42.4076 16.2061 43.2939 16.433 44.1723 16.433C45.0508 16.433 45.9371 16.2143 46.5119 15.6046C46.5916 15.5186 46.6635 15.4248 46.7354 15.331H49.0992C48.8918 16.0657 48.5643 16.7299 48.0691 17.2454C47.111 18.2531 45.6339 18.6205 44.1723 18.6205C42.7108 18.6205 41.2337 18.2609 40.2755 17.2454C39.3174 16.2299 38.9661 14.6828 38.9661 13.1435C38.9661 11.6043 39.3096 10.0494 40.2755 9.04168C41.242 8.03396 42.7108 7.66663 44.1723 7.66663C45.6339 7.66663 47.111 8.02618 48.0691 9.04168C49.0351 10.0572 49.3786 11.6043 49.3786 13.1435V13.1431Z" fill="currentColor"/>
      <path d="M61.4045 13.1431V13.9948H55.0243V12.2996H59.2564C59.1602 11.6825 58.9372 11.1043 58.5378 10.682C57.963 10.0727 57.0762 9.85409 56.1982 9.85409C55.3202 9.85409 54.4335 10.0727 53.8587 10.682C53.2839 11.2913 53.0759 12.2213 53.0759 13.1435C53.0759 14.0658 53.2834 15.003 53.8587 15.6046C54.4335 16.2061 55.3202 16.433 56.1982 16.433C57.0762 16.433 57.963 16.2143 58.5378 15.6046C58.6179 15.5186 58.6894 15.4248 58.7608 15.331H61.1251C60.9171 16.0657 60.5897 16.7299 60.0945 17.2454C59.1364 18.2531 57.6593 18.6205 56.1982 18.6205C54.7372 18.6205 53.2596 18.2609 52.3014 17.2454C51.3432 16.2299 50.9919 14.6828 50.9919 13.1435C50.9919 11.6043 51.3355 10.0494 52.3014 9.04168C53.2678 8.03396 54.7367 7.66663 56.1982 7.66663C57.6598 7.66663 59.1364 8.02618 60.0945 9.04168C61.061 10.0572 61.4045 11.6043 61.4045 13.1435V13.1431Z" fill="currentColor"/>
      <path d="M80.242 18.6214C81.7035 18.6214 83.1801 18.4105 84.1383 17.809C85.0965 17.2075 85.4482 16.2931 85.4482 15.3869C85.4482 14.4807 85.1042 13.5585 84.1383 12.9647C83.1801 12.371 81.703 12.1518 80.242 12.1518C79.6186 12.1518 79.0438 12.0658 78.6366 11.8394C78.2294 11.6047 78.0778 11.2534 78.0778 10.9017C78.0778 10.5499 78.2216 10.1908 78.6366 9.9639C79.0438 9.72921 79.6749 9.65147 80.2973 9.65147C80.9198 9.65147 81.5509 9.73747 81.9591 9.9639C82.3663 10.1986 82.5179 10.5499 82.5179 10.9017H84.9531C84.9531 9.99499 84.6421 9.07327 83.7719 8.47951C82.9017 7.88576 81.5679 7.66663 80.2424 7.66663C78.9169 7.66663 77.5837 7.8775 76.713 8.47951C75.8427 9.08104 75.5308 9.99499 75.5308 10.9017C75.5308 11.8083 75.8423 12.73 76.713 13.3238C77.5832 13.9176 78.9165 14.1367 80.2424 14.1367C80.929 14.1367 81.688 14.2227 82.1428 14.4491C82.5985 14.676 82.7579 15.0351 82.7579 15.3869C82.7579 15.7387 82.5985 16.0977 82.1428 16.3246C81.688 16.5511 80.9931 16.6371 80.3066 16.6371C79.62 16.6371 78.9169 16.5511 78.4694 16.3246C78.0224 16.0982 77.8543 15.7387 77.8543 15.3869H75.0435C75.0435 16.2935 75.3865 17.2153 76.3534 17.809C77.3194 18.4028 78.7809 18.6214 80.2424 18.6214H80.242Z" fill="currentColor"/>
      <path d="M97.4733 13.1431V13.9948H91.0932V12.2996H95.3252C95.23 11.6825 95.006 11.1043 94.6071 10.682C94.0313 10.0727 93.1456 9.85409 92.2666 9.85409C91.3876 9.85409 90.5018 10.0727 89.927 10.682C89.3522 11.2913 89.1452 12.2213 89.1452 13.1435C89.1452 14.0658 89.3522 15.003 89.927 15.6046C90.5018 16.2061 91.3886 16.433 92.2666 16.433C93.1446 16.433 94.0313 16.2143 94.6071 15.6046C94.6863 15.5186 94.7587 15.4248 94.8301 15.331H97.1935C96.9855 16.0657 96.6585 16.7299 96.1639 17.2454C95.2057 18.2531 93.7281 18.6205 92.2666 18.6205C90.805 18.6205 89.3284 18.2609 88.3703 17.2454C87.4121 16.2299 87.0613 14.6828 87.0613 13.1435C87.0613 11.6043 87.4043 10.0494 88.3703 9.04168C89.3367 8.03396 90.806 7.66663 92.2666 7.66663C93.7272 7.66663 95.2057 8.02618 96.1639 9.04168C97.1298 10.0572 97.4729 11.6043 97.4729 13.1435L97.4733 13.1431Z" fill="currentColor"/>
      <path d="M109.499 13.1431V13.9948H103.119V12.2996H107.351C107.256 11.6825 107.032 11.1043 106.632 10.682C106.057 10.0727 105.172 9.85409 104.293 9.85409C103.414 9.85409 102.528 10.0727 101.953 10.682C101.378 11.2913 101.17 12.2213 101.17 13.1435C101.17 14.0658 101.378 15.003 101.953 15.6046C102.528 16.2061 103.415 16.433 104.293 16.433C105.171 16.433 106.057 16.2143 106.632 15.6046C106.712 15.5186 106.784 15.4248 106.856 15.331H109.22C109.012 16.0657 108.685 16.7299 108.19 17.2454C107.231 18.2531 105.754 18.6205 104.293 18.6205C102.831 18.6205 101.355 18.2609 100.396 17.2454C99.4382 16.2299 99.0864 14.6828 99.0864 13.1435C99.0864 11.6043 99.4295 10.0494 100.396 9.04168C101.362 8.03396 102.832 7.66663 104.293 7.66663C105.754 7.66663 107.231 8.02618 108.19 9.04168C109.156 10.0572 109.499 11.6043 109.499 13.1435V13.1431Z" fill="currentColor"/>
      <path d="M113.5 4.62817H111.104V18.6217H113.5V4.62817Z" fill="currentColor"/>
      <path d="M117.589 12.8154L121.517 18.6208H118.554L114.625 12.8154L118.554 8.15088H121.517L117.589 12.8154Z" fill="currentColor"/>
      <g clip-path="url(#dsh-wordmark-whale-clip)">
        <path d="M23.0584 4.95203C22.8129 4.83203 22.7074 5.06103 22.5639 5.17704C22.5149 5.21454 22.4734 5.26354 22.4319 5.30854C22.0734 5.69155 21.6543 5.94306 21.1073 5.91306C20.3073 5.86806 19.6243 6.11957 19.0203 6.73158C18.8918 5.97706 18.4652 5.52655 17.8162 5.23754C17.4767 5.08753 17.1332 4.93703 16.8952 4.61052C16.7292 4.37801 16.6837 4.11901 16.6007 3.8635C16.5477 3.70949 16.4952 3.55199 16.3177 3.52549C16.1252 3.49549 16.0497 3.65699 15.9742 3.792C15.6722 4.34401 15.5552 4.95203 15.5667 5.56805C15.5932 6.95359 16.1782 8.05712 17.3407 8.84215C17.4727 8.93215 17.5067 9.02215 17.4652 9.15366C17.3857 9.42416 17.2917 9.68667 17.2087 9.95718C17.1557 10.1297 17.0767 10.1677 16.8917 10.0922C16.2537 9.82568 15.7027 9.43117 15.2156 8.95465C14.3891 8.15513 13.6416 7.2726 12.7096 6.58158C12.4906 6.42007 12.2716 6.27007 12.045 6.12707C11.094 5.20354 12.1696 4.44502 12.4186 4.35501C12.6791 4.26101 12.5091 3.938 11.6675 3.942C10.826 3.9455 10.056 4.22751 9.07446 4.60302C8.93096 4.65952 8.77995 4.70052 8.62545 4.73452C7.73492 4.56552 6.80989 4.52802 5.84386 4.63702C4.02481 4.83953 2.57177 5.69955 1.50373 7.1676C0.220694 8.93215 -0.0813148 10.9372 0.288196 13.0283C0.676708 15.2323 1.80174 17.0569 3.53029 18.4834C5.32285 19.9625 7.38741 20.6875 9.74298 20.5485C11.1735 20.466 12.7661 20.2745 14.5626 18.7539C15.0156 18.9795 15.4912 19.0695 16.2797 19.137C16.8872 19.1935 17.4722 19.107 17.9252 19.013C18.6347 18.8629 18.5857 18.2059 18.3292 18.0854C16.2497 17.1169 16.7062 17.5109 16.2912 17.1919C17.3477 15.9419 18.9618 13.7198 19.4598 10.6942C19.5088 10.3602 19.5713 9.88968 19.5638 9.61917C19.5598 9.45417 19.5978 9.39016 19.7863 9.37116C20.3073 9.31116 20.8128 9.16866 21.2773 8.91315C22.6249 8.17713 23.1684 6.96809 23.2964 5.51905C23.3154 5.29754 23.2924 5.06853 23.0584 4.95203ZM11.3165 17.9954C9.30097 16.4109 8.32344 15.8894 7.91992 15.9119C7.54241 15.9344 7.61042 16.3664 7.69342 16.6479C7.78042 16.9259 7.89342 17.1174 8.05193 17.3614C8.16143 17.5229 8.23694 17.7629 7.94243 17.9434C7.29341 18.3449 6.16487 17.8084 6.11187 17.7819C4.79833 17.0084 3.7003 15.9874 2.92628 14.5908C2.17875 13.2468 1.74474 11.8047 1.67324 10.2657C1.65424 9.89418 1.76374 9.76267 2.13375 9.69517C2.62077 9.60517 3.12278 9.58617 3.6093 9.65767C5.66636 9.95818 7.41741 10.8777 8.88545 12.3348C9.72348 13.1643 10.3575 14.1558 11.0105 15.1243C11.705 16.1529 12.4521 17.1329 13.4036 17.9364C13.7396 18.2179 14.0076 18.4319 14.2641 18.5899C13.4906 18.6764 12.1996 18.6949 11.3165 17.9964V17.9954ZM12.2826 11.7817C12.2826 11.6167 12.4146 11.4852 12.5806 11.4852C12.6181 11.4852 12.6521 11.4927 12.6826 11.5037C12.7241 11.5187 12.7621 11.5412 12.7921 11.5752C12.8451 11.6277 12.8751 11.7027 12.8751 11.7817C12.8751 11.9467 12.7431 12.0782 12.5771 12.0782C12.4111 12.0782 12.2826 11.9467 12.2826 11.7817ZM15.2831 13.3208C15.0906 13.3998 14.8981 13.4673 14.7131 13.4748C14.4261 13.4898 14.1131 13.3733 13.9431 13.2308C13.6791 13.0093 13.4901 12.8853 13.4111 12.4988C13.3771 12.3338 13.3961 12.0782 13.4261 11.9317C13.4941 11.6162 13.4186 11.4137 13.1961 11.2297C13.0151 11.0797 12.7846 11.0382 12.5316 11.0382C12.4371 11.0382 12.3506 10.9967 12.2861 10.9632C12.1806 10.9107 12.0936 10.7792 12.1766 10.6177C12.2031 10.5652 12.3316 10.4377 12.3616 10.4152C12.7051 10.2197 13.1011 10.2837 13.4676 10.4302C13.8071 10.5692 14.0641 10.8242 14.4336 11.1847C14.8111 11.6202 14.8791 11.7402 15.0941 12.0672C15.2641 12.3228 15.4186 12.5853 15.5247 12.8858C15.5887 13.0733 15.5057 13.2268 15.2831 13.3208Z" fill="currentColor"/>
      </g>
      <rect x="129.348" y="5.5" width="52" height="14" rx="2" fill="currentColor"/>
      <g clip-path="url(#dsh-wordmark-badge-clip)">
        <path d="M132.848 8.93205H134.08V16.137H132.848V8.93205ZM136.5 8.93205H137.732V16.137H136.5V8.93205ZM133.365 13.024V11.99H137.193V13.024H133.365Z" fill="var(--brand-badge-text)"/>
        <path d="M140.397 14.432L140.672 13.453H143.202L143.532 14.432H140.397ZM140.287 16.137H139.055L141.277 8.93205H142.201L142.146 9.74605L140.947 13.915H140.969L140.287 16.137ZM145.039 16.137H143.741L143.07 13.948L143.081 13.937L141.871 9.74605L141.926 8.93205H142.817L145.039 16.137Z" fill="var(--brand-badge-text)"/>
        <path d="M146.846 8.93205H149.068C149.852 8.93205 150.443 9.11538 150.839 9.48205C151.235 9.84138 151.433 10.3327 151.433 10.956C151.433 11.22 151.396 11.4657 151.323 11.693C151.249 11.9204 151.125 12.1257 150.949 12.309C150.773 12.4924 150.531 12.65 150.223 12.782C149.922 12.9067 149.541 13.0057 149.079 13.079V13.321H146.846V12.639L148.023 12.485C148.631 12.4044 149.09 12.298 149.398 12.166C149.706 12.034 149.915 11.8764 150.025 11.693C150.135 11.5024 150.19 11.2934 150.19 11.066C150.19 10.6994 150.083 10.417 149.871 10.219C149.658 10.021 149.324 9.92205 148.87 9.92205H146.846V8.93205ZM146.395 8.93205H147.627V16.137H146.395V8.93205ZM151.917 16.093V16.137H150.366L149.024 14.322C148.87 14.1094 148.73 13.9407 148.606 13.816C148.481 13.684 148.345 13.5887 148.199 13.53C148.052 13.464 147.872 13.42 147.66 13.398C147.447 13.3687 147.176 13.3504 146.846 13.343V13.145H149.079C149.233 13.211 149.368 13.2844 149.486 13.365C149.61 13.4457 149.735 13.5447 149.86 13.662C149.992 13.7794 150.138 13.937 150.3 14.135L151.917 16.093Z" fill="var(--brand-badge-text)"/>
        <path d="M153.58 9.57005L153.591 8.93205H154.46L157.584 15.51V16.137H156.704L153.58 9.57005ZM158.024 16.137H156.968L156.88 8.93205H158.024V16.137ZM154.24 16.137H153.096V8.93205H154.152L154.24 16.137Z" fill="var(--brand-badge-text)"/>
        <path d="M159.963 8.93205H161.206V16.137H159.963V8.93205ZM160.095 9.96605V8.93205H164.858V9.96605H160.095ZM160.095 16.137V15.103H164.902V16.137H160.095ZM160.095 13.013V11.99H164.374V13.013H160.095Z" fill="var(--brand-badge-text)"/>
        <path d="M169.052 15.257C169.543 15.257 169.895 15.1654 170.108 14.982C170.328 14.7987 170.438 14.5457 170.438 14.223C170.438 14.047 170.405 13.8967 170.339 13.772C170.273 13.6474 170.152 13.5337 169.976 13.431C169.807 13.321 169.558 13.2147 169.228 13.112L168.491 12.881C167.846 12.6757 167.38 12.4044 167.094 12.067C166.808 11.7297 166.665 11.3007 166.665 10.78C166.665 10.428 166.76 10.1017 166.951 9.80105C167.142 9.50038 167.428 9.25838 167.809 9.07505C168.19 8.89172 168.663 8.80005 169.228 8.80005C169.631 8.80005 169.998 8.82938 170.328 8.88805C170.665 8.93938 171.039 9.01638 171.45 9.11905L171.274 10.175C170.834 10.0504 170.442 9.96238 170.097 9.91105C169.76 9.85238 169.463 9.82305 169.206 9.82305C168.737 9.82305 168.403 9.90738 168.205 10.076C168.007 10.2374 167.908 10.439 167.908 10.681C167.908 10.857 167.941 11.0147 168.007 11.154C168.073 11.286 168.19 11.407 168.359 11.517C168.535 11.627 168.784 11.7334 169.107 11.836L169.866 12.078C170.526 12.276 170.995 12.5327 171.274 12.848C171.553 13.156 171.692 13.585 171.692 14.135C171.692 14.5604 171.589 14.9344 171.384 15.257C171.179 15.5797 170.878 15.8327 170.482 16.016C170.093 16.1994 169.609 16.291 169.03 16.291C168.627 16.291 168.212 16.247 167.787 16.159C167.362 16.071 166.9 15.9427 166.401 15.774L166.665 14.718C167.156 14.894 167.6 15.0297 167.996 15.125C168.399 15.213 168.751 15.257 169.052 15.257Z" fill="var(--brand-badge-text)"/>
        <path d="M175.809 15.257C176.3 15.257 176.652 15.1654 176.865 14.982C177.085 14.7987 177.195 14.5457 177.195 14.223C177.195 14.047 177.162 13.8967 177.096 13.772C177.03 13.6474 176.909 13.5337 176.733 13.431C176.564 13.321 176.315 13.2147 175.985 13.112L175.248 12.881C174.603 12.6757 174.137 12.4044 173.851 12.067C173.565 11.7297 173.422 11.3007 173.422 10.78C173.422 10.428 173.517 10.1017 173.708 9.80105C173.899 9.50038 174.185 9.25838 174.566 9.07505C174.947 8.89172 175.42 8.80005 175.985 8.80005C176.388 8.80005 176.755 8.82938 177.085 8.88805C177.422 8.93938 177.796 9.01638 178.207 9.11905L178.031 10.175C177.591 10.0504 177.199 9.96238 176.854 9.91105C176.517 9.85238 176.22 9.82305 175.963 9.82305C175.494 9.82305 175.16 9.90738 174.962 10.076C174.764 10.2374 174.665 10.439 174.665 10.681C174.665 10.857 174.698 11.0147 174.764 11.154C174.83 11.286 174.947 11.407 175.116 11.517C175.292 11.627 175.541 11.7334 175.864 11.836L176.623 12.078C177.283 12.276 177.752 12.5327 178.031 12.848C178.31 13.156 178.449 13.585 178.449 14.135C178.449 14.5604 178.346 14.9344 178.141 15.257C177.936 15.5797 177.635 15.8327 177.239 16.016C176.85 16.1994 176.366 16.291 175.787 16.291C175.384 16.291 174.969 16.247 174.544 16.159C174.119 16.071 173.657 15.9427 173.158 15.774L173.422 14.718C173.913 14.894 174.357 15.0297 174.753 15.125C175.156 15.213 175.508 15.257 175.809 15.257Z" fill="var(--brand-badge-text)"/>
      </g>
      <defs>
        <clipPath id="dsh-wordmark-whale-clip">
          <rect width="23.16" height="17.0435" fill="white" transform="translate(0.141602 3.52185)"/>
        </clipPath>
        <clipPath id="dsh-wordmark-badge-clip">
          <rect width="46" height="14" fill="white" transform="translate(132.348 5.5)"/>
        </clipPath>
      </defs>
    </svg>`;
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
async function readJson(response, operation) {
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
function escapeHtml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function callbackPage(state, message) {
	const success = state === "success";
	return `<!doctype html>
<html lang="en" data-page="oauth-callback" data-state="${state}" data-layout="flat">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="data:,">
  <title>${success ? "OpenAI sign-in complete" : "OpenAI sign-in failed"}</title>
  <style>
    :root { color-scheme: light dark; --page: #fff; --text: #0f1115; --secondary: #61666b;
      --brand-badge-text: #fff; --error: #ec1313; }
    @media (prefers-color-scheme: dark) {
      :root { --page: #151517; --text: #f9fafb; --secondary: #adb2b8;
        --brand-badge-text: #151517; --error: #f25a5a; }
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; min-height: 100dvh; }
    body { margin: 0; display: grid; place-items: center; padding: 32px 24px; background: var(--page); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
        'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; }
    .shell { width: min(560px, 100%); text-align: center; }
    .brand { display: inline-flex; margin-bottom: 36px; color: var(--text); }
    .brand-wordmark { display: block; width: 182px; height: auto; }
    h1 { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.3; letter-spacing: -.025em; }
    html[data-state='error'] h1 { color: var(--error); }
    .message { margin: 9px 0 0; color: var(--secondary); font-size: 14px; line-height: 1.6; }
    @media (max-width: 480px) {
      body { padding: 24px 20px; }
      .brand { margin-bottom: 32px; }
      .brand-wordmark { width: 164px; }
      h1 { font-size: 23px; }
    }
  </style>
</head>
<body>
  <main class="shell" aria-labelledby="callback-title">
    <div class="brand" role="img" aria-label="DeepSeek Harness">${BRAND_WORDMARK}</div>
    <h1 id="callback-title">${success ? "OpenAI sign-in complete" : "OpenAI sign-in failed"}</h1>
    <p class="message" role="${success ? "status" : "alert"}">${escapeHtml(message)}</p>
  </main>
</body>
</html>`;
}
function successPage() {
	return callbackPage("success", "You can close this window and return to DeepSeek Harness.");
}
function errorPage(message) {
	return callbackPage("error", message);
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
	return credentialFromToken(await readJson(await fetch(TOKEN_URL, {
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
		const value = await readJson(await fetch(DEVICE_USER_CODE_URL, {
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
				const token = await readJson(response, "device authorization");
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
			return credentialFromToken(await readJson(await fetch(TOKEN_URL, {
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
export { OPENAI_CODEX_PROVIDER as a, CredentialStoreError as i, AuthController as n, SecureCredentialStore as o, AuthControllerError as r, resolveDshHome as s, createOpenAiOAuth as t };
