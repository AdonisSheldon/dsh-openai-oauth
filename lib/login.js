#!/usr/bin/env node
import { l as AuthControllerError, r as createPluginRuntime } from "./src.js";
import { createInterface } from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";
//#region src/login.ts
const USAGE = `Usage: dsh-openai-login [--browser | --device-code]

Options:
  --browser              Use PKCE browser login with a loopback callback
  --device-code          Use Device Code login for headless or remote browsers
  --method <method>      Use browser or device-code
  -h, --help             Show this help
`;
var LoginUsageError = class extends Error {};
function normalizeMethod(value) {
	if (value === "browser") return "browser";
	if (value === "device-code" || value === "device_code") return "device_code";
}
/** Parse one explicit login method without accepting implicit fallbacks. */
function parseLoginArgs(argv) {
	let method;
	let help = false;
	const choose = (next) => {
		if (method !== void 0) throw new LoginUsageError("Choose exactly one login method.");
		method = next;
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "-h" || argument === "--help") help = true;
		else if (argument === "--browser") choose("browser");
		else if (argument === "--device-code") choose("device_code");
		else if (argument === "--method") {
			const value = argv[index + 1];
			if (value === void 0) throw new LoginUsageError("--method requires browser or device-code.");
			const selected = normalizeMethod(value);
			if (selected === void 0) throw new LoginUsageError("--method must be browser or device-code.");
			choose(selected);
			index += 1;
		} else if (argument.startsWith("--method=")) {
			const selected = normalizeMethod(argument.slice(9));
			if (selected === void 0) throw new LoginUsageError("--method must be browser or device-code.");
			choose(selected);
		} else throw new LoginUsageError(`Unknown option: ${argument}`);
	}
	return method === void 0 ? { help } : {
		method,
		help
	};
}
function processIo() {
	const readline = createInterface({
		input: stdin,
		output: stdout
	});
	return {
		terminal: Boolean(stdin.isTTY && stdout.isTTY),
		question: (prompt) => readline.question(prompt),
		write: (value) => {
			stdout.write(value);
		},
		writeError: (value) => {
			stderr.write(value);
		},
		close: () => {
			readline.close();
		}
	};
}
async function selectMethod(options, io) {
	if (options.method !== void 0) return options.method;
	if (!io.terminal) throw new LoginUsageError("No interactive terminal. Pass --browser or --device-code.");
	const answer = (await io.question("Choose OpenAI login method:\n  1. Browser (recommended)\n  2. Device Code\nChoice [1]: ")).trim().toLowerCase();
	if (answer === "" || answer === "1" || answer === "browser") return "browser";
	if (answer === "2" || answer === "device-code" || answer === "device_code") return "device_code";
	throw new LoginUsageError("Choose 1 for Browser or 2 for Device Code.");
}
function printPending(status, io) {
	if (status.method === "browser") {
		io.write(`Open this URL in your browser:\n${status.browser.authorizationUrl}\n\n`);
		io.write("Waiting for the one-time loopback callback on 127.0.0.1:1455…\n");
		return;
	}
	io.write(`Open this URL:\n${status.deviceCode.verificationUri}\n\n`);
	io.write(`Enter this code: ${status.deviceCode.userCode}\n`);
	io.write(`The code expires at ${new Date(status.deviceCode.expiresAt).toISOString()}.\n`);
}
function fixedFailure(reason) {
	return reason instanceof AuthControllerError ? reason.message : "OpenAI sign-in failed. Retry or choose another login method.";
}
/** Run one selected OAuth attempt and persist credentials through the shared controller. */
async function runLogin(argv, dependencies = {}) {
	const io = dependencies.io ?? processIo();
	let runtime;
	let attemptId;
	let interrupted = false;
	let cancellation;
	const interrupt = () => {
		interrupted = true;
		if (attemptId !== void 0 && runtime !== void 0 && cancellation === void 0) cancellation = runtime.controller.cancel(attemptId);
	};
	dependencies.signal?.addEventListener("abort", interrupt, { once: true });
	try {
		let options;
		try {
			options = parseLoginArgs(argv);
			if (options.help) {
				io.write(USAGE);
				return 0;
			}
			const method = await selectMethod(options, io);
			runtime = (dependencies.createRuntime ?? createPluginRuntime)();
			const pending = await runtime.controller.start(method);
			attemptId = pending.attemptId;
			printPending(pending, io);
			if (dependencies.signal?.aborted) interrupt();
			const final = await runtime.controller.waitForAttempt(attemptId);
			if (cancellation !== void 0) await cancellation.catch(() => void 0);
			if (interrupted) {
				io.writeError("OpenAI sign-in cancelled.\n");
				return 130;
			}
			if (final.state === "connected") {
				io.write("OpenAI sign-in completed.\n");
				return 0;
			}
			if (final.state === "failed") io.writeError(`${final.error.message}\n`);
			else io.writeError("OpenAI sign-in did not complete.\n");
			return 1;
		} catch (reason) {
			if (reason instanceof LoginUsageError) {
				io.writeError(`${reason.message}\n${USAGE}`);
				return 2;
			}
			if (interrupted || dependencies.signal?.aborted) {
				io.writeError("OpenAI sign-in cancelled.\n");
				return 130;
			}
			io.writeError(`${fixedFailure(reason)}\n`);
			return 1;
		}
	} finally {
		dependencies.signal?.removeEventListener("abort", interrupt);
		await runtime?.controller.dispose();
		io.close();
	}
}
//#endregion
//#region src/login-main.ts
const signal = new AbortController();
process.once("SIGINT", () => {
	signal.abort();
});
process.once("SIGTERM", () => {
	signal.abort();
});
process.exitCode = await runLogin(process.argv.slice(2), { signal: signal.signal });
//#endregion
export {};
