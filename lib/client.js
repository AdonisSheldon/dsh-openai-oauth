window.__ModuleLoader__.load({
	id: "dsh-openai-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/protocol.ts
		/** Exact local route family owned by this plugin. */
		const OAUTH_ROUTE_PATH = "/api/plugins/openai-oauth";
		//#endregion
		//#region src/client/locales.ts
		/** Copy owned by the OpenAI OAuth settings section. */
		const en = {
			nav: "OpenAI OAuth",
			title: "OpenAI OAuth",
			intro: "Connect ChatGPT account access to the OpenAI Codex model provider. Credentials stay in the local Harness Host.",
			status: "Connection status",
			loading: "Loading OAuth status…",
			connected: "Connected",
			pending: "Sign-in in progress",
			disconnected: "Not connected",
			failed: "Sign-in failed",
			methodLegend: "Login method",
			browser: "Browser login (recommended)",
			browserHelp: "Uses PKCE and a one-time callback on 127.0.0.1:1455. This does not bind the account to the machine.",
			device: "Device Code",
			deviceHelp: "Use when the browser is on another machine or the local callback port is unavailable.",
			signIn: "Sign in",
			signOut: "Sign out",
			cancel: "Cancel sign-in",
			refresh: "Refresh status",
			browserWaiting: "Waiting for the loopback callback…",
			browserWaitingHelp: "Finish sign-in in the OpenAI window. This page updates automatically.",
			continueBrowser: "Continue in browser",
			deviceInstructions: "Open the verification page and enter this code:",
			copyCode: "Copy device code",
			copiedCode: "Device code copied",
			copyHint: "Click to copy",
			copied: "Copied",
			copyFailed: "Could not copy the device code. Copy it manually.",
			openVerification: "Open verification page",
			expires: "This code expires at {time}.",
			requestFailed: "The local Harness Host did not complete the OAuth request.",
			modelsTitle: "Model list",
			modelsIntro: "Built-in and custom Codex models. Custom entries extend the list; an override changes a built-in context window or output limit.",
			modelsLoading: "Loading models…",
			modelsEmpty: "No models are available.",
			modelsWarning: "The stored model list could not be read ({code}). Built-in models are shown.",
			actionRetry: "Retry",
			badgeBuiltIn: "Built-in",
			badgeCustom: "Custom",
			badgeOverridden: "Overridden",
			contextWindowLabel: "Context window",
			maxTokensLabel: "Max output tokens",
			actionEdit: "Edit",
			actionDelete: "Delete",
			actionReset: "Reset",
			actionAddModel: "Add model",
			addModelTitle: "Add a model",
			editModelTitle: "Edit {id}",
			fieldId: "Model id",
			fieldName: "Display name (optional)",
			fieldContextWindow: "Context window",
			fieldMaxTokens: "Max output tokens",
			builtInDefault: "Built-in default: {value}",
			actionSave: "Save",
			actionCancel: "Cancel",
			validationId: "Use 1–64 characters — letters, digits, dot, underscore, colon or dash — starting with a letter or digit.",
			validationName: "Use at most 64 characters with no control characters.",
			validationContextWindow: "Enter a whole number from 1024 to 10000000.",
			validationMaxTokens: "Enter a whole number from 1 to the context window."
		};
		/** Simplified Chinese copy. */
		const zh = {
			nav: "OpenAI OAuth",
			title: "OpenAI OAuth",
			intro: "使用 ChatGPT 账号连接 OpenAI Codex 模型提供方。凭据只保存在本机 Harness Host 中。",
			status: "连接状态",
			loading: "正在读取 OAuth 状态…",
			connected: "已连接",
			pending: "登录进行中",
			disconnected: "尚未连接",
			failed: "登录失败",
			methodLegend: "登录方式",
			browser: "浏览器登录（推荐）",
			browserHelp: "使用 PKCE 和 127.0.0.1:1455 上的一次性回调；这不会把账号绑定到机器。",
			device: "设备代码",
			deviceHelp: "浏览器位于另一台机器，或本地回调端口不可用时使用。",
			signIn: "登录",
			signOut: "退出登录",
			cancel: "取消登录",
			refresh: "刷新状态",
			browserWaiting: "正在等待本地回调…",
			browserWaitingHelp: "请在已打开的 OpenAI 页面中完成授权，此处会自动更新。",
			continueBrowser: "继续浏览器登录",
			deviceInstructions: "打开验证页面并输入此代码：",
			copyCode: "复制设备代码",
			copiedCode: "设备代码已复制",
			copyHint: "点击复制",
			copied: "已复制",
			copyFailed: "无法复制设备代码，请手动复制。",
			openVerification: "打开验证页面",
			expires: "此代码将在 {time} 过期。",
			requestFailed: "本机 Harness Host 未能完成 OAuth 请求。",
			modelsTitle: "模型列表",
			modelsIntro: "内置与自定义 Codex 模型。自定义条目会追加到列表；覆盖会修改某个内置模型的上下文窗口或输出上限。",
			modelsLoading: "正在读取模型列表…",
			modelsEmpty: "当前没有可用模型。",
			modelsWarning: "无法读取已保存的模型列表（{code}）。现显示内置模型。",
			actionRetry: "重试",
			badgeBuiltIn: "内置",
			badgeCustom: "自定义",
			badgeOverridden: "已覆盖",
			contextWindowLabel: "上下文窗口",
			maxTokensLabel: "最大输出 token",
			actionEdit: "编辑",
			actionDelete: "删除",
			actionReset: "重置",
			actionAddModel: "添加模型",
			addModelTitle: "添加模型",
			editModelTitle: "编辑 {id}",
			fieldId: "模型 ID",
			fieldName: "显示名称（可选）",
			fieldContextWindow: "上下文窗口",
			fieldMaxTokens: "最大输出 token",
			builtInDefault: "内置默认值：{value}",
			actionSave: "保存",
			actionCancel: "取消",
			validationId: "请使用 1–64 个字符（字母、数字、点、下划线、冒号或连字符），并以字母或数字开头。",
			validationName: "请使用不超过 64 个字符，且不能包含控制字符。",
			validationContextWindow: "请输入 1024 到 10000000 之间的整数。",
			validationMaxTokens: "请输入 1 到上下文窗口之间的整数。"
		};
		//#endregion
		//#region src/client/index.tsx
		const styles = {
			section: {
				display: "flex",
				flexDirection: "column",
				gap: 12,
				maxWidth: 720,
				padding: "0 0 32px",
				color: "var(--dsw-alias-label-primary)"
			},
			title: {
				fontSize: 18,
				fontWeight: 600,
				lineHeight: "24px",
				margin: 0
			},
			intro: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 13,
				lineHeight: "20px",
				margin: 0
			},
			panel: {
				display: "flex",
				flexDirection: "column",
				gap: 16,
				marginTop: 8
			},
			statusSummary: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 16,
				minHeight: 36,
				paddingBottom: 16,
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			},
			heading: {
				fontSize: 14,
				fontWeight: 500,
				lineHeight: "22px",
				margin: 0
			},
			status: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				minHeight: 22,
				fontSize: 13,
				color: "var(--dsw-alias-label-secondary)"
			},
			dot: {
				width: 8,
				height: 8,
				borderRadius: "50%",
				flex: "0 0 auto"
			},
			fieldset: {
				border: 0,
				margin: 0,
				padding: 0
			},
			choice: {
				display: "grid",
				gridTemplateColumns: "20px minmax(0, 1fr)",
				gap: "2px 8px",
				marginTop: 12,
				cursor: "pointer"
			},
			choiceHelp: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 12,
				lineHeight: "18px",
				gridColumn: "2"
			},
			actions: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 6
			},
			pending: {
				display: "flex",
				flexDirection: "column",
				gap: 14,
				background: "var(--dsw-alias-bg-module-platform)",
				borderRadius: 12,
				padding: "14px 16px"
			},
			pendingLead: {
				display: "grid",
				gridTemplateColumns: "10px minmax(0, 1fr)",
				alignItems: "start",
				gap: 10
			},
			pendingDot: {
				width: 8,
				height: 8,
				marginTop: 6,
				borderRadius: "50%",
				background: "var(--dsw-alias-state-business-primary)"
			},
			pendingTitle: {
				fontSize: 14,
				fontWeight: 500,
				lineHeight: "22px",
				margin: 0
			},
			pendingHelp: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 12,
				lineHeight: "18px",
				margin: "2px 0 0"
			},
			pendingActions: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 6,
				paddingLeft: 20
			},
			primaryLink: {
				boxSizing: "border-box",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 4,
				height: 36,
				padding: "0 14px",
				borderRadius: 18,
				background: "var(--dsw-alias-button-primary-fill)",
				color: "var(--dsw-alias-label-primary-foreground)",
				fontSize: 14,
				lineHeight: "22px",
				textDecoration: "none"
			},
			codeButton: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				width: "fit-content",
				margin: "8px 0 0",
				padding: "6px 10px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-3)",
				color: "var(--dsw-alias-label-primary)",
				font: "inherit",
				cursor: "pointer"
			},
			code: {
				fontSize: 18,
				fontWeight: 600,
				letterSpacing: "0.08em"
			},
			copyHint: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 12,
				lineHeight: "18px"
			},
			error: {
				color: "var(--dsw-alias-state-error-primary)",
				fontSize: 12,
				lineHeight: "18px",
				margin: 0
			},
			secondary: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 12,
				lineHeight: "18px",
				margin: "6px 0 0"
			},
			models: {
				display: "flex",
				flexDirection: "column",
				gap: 12,
				marginTop: 8,
				paddingTop: 20,
				borderTop: "1px solid var(--dsw-alias-border-l2)"
			},
			modelsHeader: {
				display: "flex",
				flexDirection: "column",
				gap: 2
			},
			warning: {
				color: "var(--dsw-alias-state-warn-primary)",
				fontSize: 12,
				lineHeight: "18px",
				margin: 0
			},
			modelList: {
				listStyle: "none",
				display: "flex",
				flexDirection: "column",
				gap: 1,
				margin: 0,
				padding: 0,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 12,
				overflow: "hidden"
			},
			modelRow: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr) auto auto",
				alignItems: "center",
				gap: 12,
				padding: "10px 12px",
				background: "var(--dsw-alias-bg-layer-1)"
			},
			modelMain: {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				minWidth: 0
			},
			modelName: {
				fontSize: 13,
				fontWeight: 500,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-primary)"
			},
			modelId: {
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--dsw-alias-label-tertiary)",
				overflowWrap: "anywhere"
			},
			modelMeta: {
				display: "flex",
				flexWrap: "wrap",
				gap: "2px 16px",
				margin: 0
			},
			modelMetaGroup: {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				margin: 0
			},
			modelMetaLabel: {
				fontSize: 11,
				lineHeight: "16px",
				color: "var(--dsw-alias-label-caption)"
			},
			modelMetaValue: {
				margin: 0,
				fontSize: 13,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-secondary)"
			},
			badge: {
				justifySelf: "start",
				padding: "2px 8px",
				borderRadius: 999,
				fontSize: 11,
				lineHeight: "16px",
				whiteSpace: "nowrap"
			},
			badgeBuiltIn: {
				background: "var(--dsw-alias-bg-layer-3)",
				color: "var(--dsw-alias-label-secondary)"
			},
			badgeCustom: {
				background: "var(--dsw-alias-bg-module-platform)",
				color: "var(--dsw-alias-state-business-primary)"
			},
			badgeOverridden: {
				background: "var(--dsw-alias-bg-module-platform)",
				color: "var(--dsw-alias-state-warn-primary)"
			},
			modelActions: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				justifySelf: "end"
			},
			form: {
				display: "flex",
				flexDirection: "column",
				gap: 12,
				background: "var(--dsw-alias-bg-module-platform)",
				borderRadius: 12,
				padding: "14px 16px"
			},
			formTitle: {
				fontSize: 13,
				fontWeight: 500,
				lineHeight: "20px",
				margin: 0
			},
			formFields: {
				display: "flex",
				flexDirection: "column",
				gap: 12
			},
			fieldPair: {
				display: "flex",
				flexWrap: "wrap",
				gap: 12
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				flex: "1 1 200px",
				minWidth: 0
			},
			fieldLabel: {
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--dsw-alias-label-secondary)"
			},
			hint: {
				fontSize: 11,
				lineHeight: "16px",
				margin: 0,
				color: "var(--dsw-alias-label-caption)"
			},
			formActions: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 6
			}
		};
		async function hostRequest(path, body) {
			const response = await fetch(`${OAUTH_ROUTE_PATH}${path}`, {
				method: body === void 0 ? "GET" : "POST",
				credentials: "same-origin",
				headers: {
					accept: "application/json",
					...body === void 0 ? {} : { "content-type": "application/json" }
				},
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "object" && value.error !== null && "message" in value.error && typeof value.error.message === "string" ? value.error.message : void 0;
				throw new Error(message ?? "The local Harness Host did not complete the OAuth request.");
			}
			return value;
		}
		function trustedAuthorizationUrl(raw) {
			try {
				const url = new URL(raw);
				return url.protocol === "https:" && url.hostname === "auth.openai.com" && url.username.length === 0 && url.password.length === 0 ? url.toString() : void 0;
			} catch {
				return;
			}
		}
		/** Model id accepted by the Host: 1-64 of letter/digit/dot/underscore/colon/dash, starting alphanumeric. */
		const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
		const MODEL_CONTEXT_WINDOW_MIN = 1024;
		const MODEL_CONTEXT_WINDOW_MAX = 1e7;
		const MODEL_NAME_MAX_LENGTH = 64;
		const MODEL_NAME_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
		function isModelRow(value) {
			if (typeof value !== "object" || value === null) return false;
			const row = value;
			const nullableNumber = (input) => input === null || typeof input === "number";
			return typeof row.id === "string" && typeof row.name === "string" && typeof row.contextWindow === "number" && typeof row.maxTokens === "number" && typeof row.builtIn === "boolean" && typeof row.overridden === "boolean" && nullableNumber(row.defaultContextWindow) && nullableNumber(row.defaultMaxTokens);
		}
		/** Read the list view, or undefined when the Host answered with an unexpected shape. */
		function readModelListView(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const view = value;
			if (!Array.isArray(view.models)) return void 0;
			const models = [];
			for (const entry of view.models) {
				if (!isModelRow(entry)) return void 0;
				models.push(entry);
			}
			return {
				models,
				warning: typeof view.error === "string" ? view.error : void 0
			};
		}
		function readInteger(raw) {
			const text = raw.trim();
			return /^\d+$/.test(text) ? Number(text) : void 0;
		}
		/** Mirror the Host validation so problems appear before the request; the Host stays authoritative. */
		function validateDraft(draft) {
			const errors = {};
			if (!MODEL_ID_PATTERN.test(draft.id)) errors.id = "validationId";
			if (draft.name.length > MODEL_NAME_MAX_LENGTH || MODEL_NAME_CONTROL_PATTERN.test(draft.name)) errors.name = "validationName";
			const contextWindow = readInteger(draft.contextWindow);
			if (contextWindow === void 0 || contextWindow < MODEL_CONTEXT_WINDOW_MIN || contextWindow > MODEL_CONTEXT_WINDOW_MAX) errors.contextWindow = "validationContextWindow";
			const maxTokens = readInteger(draft.maxTokens);
			if (maxTokens === void 0 || maxTokens < 1 || contextWindow !== void 0 && maxTokens > contextWindow) errors.maxTokens = "validationMaxTokens";
			return errors;
		}
		function blankDraft() {
			return {
				mode: "add",
				id: "",
				name: "",
				contextWindow: "",
				maxTokens: "",
				locked: false,
				defaultContextWindow: null,
				defaultMaxTokens: null
			};
		}
		function draftFor(row) {
			return {
				mode: "edit",
				id: row.id,
				name: row.name,
				contextWindow: String(row.contextWindow),
				maxTokens: String(row.maxTokens),
				locked: row.builtIn,
				defaultContextWindow: row.defaultContextWindow,
				defaultMaxTokens: row.defaultMaxTokens
			};
		}
		/** Join the ids of the description elements that are actually rendered. */
		function joinIds(...ids) {
			const present = ids.filter((id) => id !== void 0);
			return present.length === 0 ? void 0 : present.join(" ");
		}
		const MODEL_FIELD_IDS = {
			id: "openai-oauth-model-id",
			name: "openai-oauth-model-name",
			contextWindow: "openai-oauth-model-context-window",
			maxTokens: "openai-oauth-model-max-tokens"
		};
		/** Dedicated settings section for the plugin-owned OAuth state machine. */
		function OpenAiOAuthSection({ t }) {
			const [status, setStatus] = (0, react.useState)();
			const [method, setMethod] = (0, react.useState)("browser");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [copiedCode, setCopiedCode] = (0, react.useState)();
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStatus(await hostRequest("/status"));
					setError(void 0);
				} catch {
					setError(t("requestFailed"));
				}
			}, [t]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => {
				if (status?.state !== "pending") return;
				const timer = window.setTimeout(() => {
					refresh();
				}, 1e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [refresh, status]);
			const start = async () => {
				const popup = (method === "browser" ? window.open("about:blank", "_blank") : null) ?? null;
				if (popup !== null) popup.opener = null;
				setBusy(true);
				setError(void 0);
				try {
					const pending = await hostRequest("/start", { method });
					setStatus(pending);
					if (pending.method === "browser") {
						const url = trustedAuthorizationUrl(pending.browser.authorizationUrl);
						if (url === void 0) throw new Error(t("requestFailed"));
						if (popup !== null) popup.location.href = url;
					}
				} catch (reason) {
					popup?.close();
					setError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			};
			const cancel = async () => {
				if (status?.state !== "pending") return;
				setBusy(true);
				setError(void 0);
				try {
					setStatus(await hostRequest("/cancel", { attemptId: status.attemptId }));
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			};
			const logout = async () => {
				setBusy(true);
				setError(void 0);
				try {
					setStatus(await hostRequest("/logout", {}));
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			};
			const copyDeviceCode = async (code) => {
				if (await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(code)) {
					setCopiedCode(code);
					setError(void 0);
					return;
				}
				setCopiedCode(void 0);
				setError(t("copyFailed"));
			};
			const connected = status?.state === "connected";
			const deviceCodeCopied = status?.state === "pending" && status.method === "device_code" && copiedCode === status.deviceCode.userCode;
			const statusText = status === void 0 ? t("loading") : connected ? t("connected") : status.state === "pending" ? t("pending") : status.state === "failed" ? t("failed") : t("disconnected");
			const statusColor = connected ? "var(--dsw-alias-state-success-primary)" : status?.state === "failed" ? "var(--dsw-alias-state-error-primary)" : status === void 0 ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-label-caption)";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: styles.section,
				"aria-labelledby": "openai-oauth-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "openai-oauth-title",
						style: styles.title,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.panel,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.statusSummary,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.heading,
									children: t("status")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.status,
									role: "status",
									"aria-live": "polite",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										style: {
											...styles.dot,
											background: statusColor
										}
									}), statusText]
								})]
							}),
							!connected && status?.state !== "pending" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
								style: styles.fieldset,
								disabled: busy,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", {
										style: styles.heading,
										children: t("methodLegend")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.choice,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: "openai-login-method",
												value: "browser",
												checked: method === "browser",
												onChange: () => {
													setMethod("browser");
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("browser") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.choiceHelp,
												children: t("browserHelp")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.choice,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: "openai-login-method",
												value: "device_code",
												checked: method === "device_code",
												onChange: () => {
													setMethod("device_code");
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("device") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.choiceHelp,
												children: t("deviceHelp")
											})
										]
									})
								]
							}) : null,
							status?.state === "pending" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.pending,
								"data-oauth-state": "pending",
								"aria-live": "polite",
								children: status.method === "browser" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.pendingLead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.pendingDot,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.pendingTitle,
										children: t("browserWaiting")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.pendingHelp,
										children: t("browserWaitingHelp")
									})] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.pendingActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
										style: styles.primaryLink,
										href: status.browser.authorizationUrl,
										target: "_blank",
										rel: "noreferrer",
										children: [
											t("continueBrowser"),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												children: "↗"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										disabled: busy,
										onClick: () => {
											cancel();
										},
										children: t("cancel")
									})]
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.pendingLead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.pendingDot,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: styles.pendingTitle,
											children: t("deviceInstructions")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											style: styles.codeButton,
											"aria-label": t(deviceCodeCopied ? "copiedCode" : "copyCode"),
											onClick: () => {
												copyDeviceCode(status.deviceCode.userCode);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												style: styles.code,
												children: status.deviceCode.userCode
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												style: {
													...styles.copyHint,
													...deviceCodeCopied ? { color: "var(--dsw-alias-state-success-primary)" } : {}
												},
												children: t(deviceCodeCopied ? "copied" : "copyHint")
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: styles.secondary,
											children: t("expires", { time: new Date(status.deviceCode.expiresAt).toLocaleTimeString() })
										})
									] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.pendingActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
										style: styles.primaryLink,
										href: status.deviceCode.verificationUri,
										target: "_blank",
										rel: "noreferrer",
										children: [
											t("openVerification"),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												children: "↗"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										disabled: busy,
										onClick: () => {
											cancel();
										},
										children: t("cancel")
									})]
								})] })
							}) : null,
							status?.state === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.error,
								role: "alert",
								children: status.error.message
							}) : null,
							error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.error,
								role: "alert",
								children: error
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.actions,
								children: [status?.state === "pending" ? null : connected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: busy,
									onClick: () => {
										logout();
									},
									children: t("signOut")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									disabled: busy || status === void 0,
									onClick: () => {
										start();
									},
									children: t("signIn")
								}), status?.state === "pending" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									disabled: busy,
									onClick: () => {
										refresh();
									},
									children: t("refresh")
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelListBlock, { t })
				]
			});
		}
		/** Model list block rendered inside the OAuth settings section, below the OAuth panel. */
		function ModelListBlock({ t }) {
			const [models, setModels] = (0, react.useState)();
			const [loadError, setLoadError] = (0, react.useState)();
			const [warning, setWarning] = (0, react.useState)();
			const [requestError, setRequestError] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)();
			const [fieldErrors, setFieldErrors] = (0, react.useState)({});
			const requested = (0, react.useRef)(false);
			const applyView = (0, react.useCallback)((view) => {
				setModels(view.models);
				setWarning(view.warning);
				setLoadError(void 0);
			}, []);
			const load = (0, react.useCallback)(async () => {
				setBusy(true);
				setRequestError(void 0);
				try {
					const view = readModelListView(await hostRequest("/models"));
					if (view === void 0) throw new Error(t("requestFailed"));
					applyView(view);
				} catch (reason) {
					setLoadError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			}, [applyView, t]);
			(0, react.useEffect)(() => {
				if (requested.current) return;
				requested.current = true;
				load();
			}, [load]);
			const openAdd = () => {
				setDraft(blankDraft());
				setFieldErrors({});
				setRequestError(void 0);
			};
			const openEdit = (row) => {
				setDraft(draftFor(row));
				setFieldErrors({});
				setRequestError(void 0);
			};
			const closeDraft = () => {
				setDraft(void 0);
				setFieldErrors({});
				setRequestError(void 0);
			};
			const updateDraft = (field, value) => {
				setDraft((current) => {
					if (current === void 0) return void 0;
					const next = { ...current };
					next[field] = value;
					return next;
				});
			};
			const submit = async () => {
				if (draft === void 0 || busy) return;
				const errors = validateDraft(draft);
				setFieldErrors(errors);
				if (errors.id !== void 0 || errors.name !== void 0 || errors.contextWindow !== void 0 || errors.maxTokens !== void 0) return;
				const contextWindow = readInteger(draft.contextWindow);
				const maxTokens = readInteger(draft.maxTokens);
				if (contextWindow === void 0 || maxTokens === void 0) return;
				const body = draft.locked || draft.name.length === 0 ? {
					id: draft.id,
					contextWindow,
					maxTokens
				} : {
					id: draft.id,
					name: draft.name,
					contextWindow,
					maxTokens
				};
				setBusy(true);
				setRequestError(void 0);
				try {
					const view = readModelListView(await hostRequest("/models/save", body));
					if (view === void 0) throw new Error(t("requestFailed"));
					applyView(view);
					setDraft(void 0);
					setFieldErrors({});
				} catch (reason) {
					setRequestError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			};
			const remove = async (row) => {
				if (busy) return;
				setBusy(true);
				setRequestError(void 0);
				try {
					const view = readModelListView(await hostRequest("/models/remove", { id: row.id }));
					if (view === void 0) throw new Error(t("requestFailed"));
					applyView(view);
					setDraft((current) => current !== void 0 && current.mode === "edit" && current.id === row.id ? void 0 : current);
				} catch (reason) {
					setRequestError(reason instanceof Error ? reason.message : t("requestFailed"));
				} finally {
					setBusy(false);
				}
			};
			const badgeStyle = (row) => row.overridden ? styles.badgeOverridden : row.builtIn ? styles.badgeBuiltIn : styles.badgeCustom;
			const badgeLabel = (row) => row.overridden ? "badgeOverridden" : row.builtIn ? "badgeBuiltIn" : "badgeCustom";
			const idError = fieldErrors.id;
			const nameError = fieldErrors.name;
			const contextWindowError = fieldErrors.contextWindow;
			const maxTokensError = fieldErrors.maxTokens;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.models,
				"aria-labelledby": "openai-oauth-models-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.modelsHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: "openai-oauth-models-title",
							style: styles.heading,
							children: t("modelsTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: styles.intro,
							children: t("modelsIntro")
						})]
					}),
					warning === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.warning,
						role: "status",
						children: t("modelsWarning", { code: warning })
					}),
					loadError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.error,
						role: "alert",
						children: loadError
					}),
					requestError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.error,
						role: "alert",
						children: requestError
					}),
					models === void 0 ? loadError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.secondary,
						role: "status",
						children: t("modelsLoading")
					}) : null : models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.secondary,
						children: t("modelsEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: styles.modelList,
						children: models.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							style: styles.modelRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.modelMain,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.modelName,
										children: row.name
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										style: styles.modelId,
										children: row.id
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
									style: styles.modelMeta,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.modelMetaGroup,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											style: styles.modelMetaLabel,
											children: t("contextWindowLabel")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											style: styles.modelMetaValue,
											children: row.contextWindow.toLocaleString()
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.modelMetaGroup,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											style: styles.modelMetaLabel,
											children: t("maxTokensLabel")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											style: styles.modelMetaValue,
											children: row.maxTokens.toLocaleString()
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										...styles.badge,
										...badgeStyle(row)
									},
									children: t(badgeLabel(row))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.modelActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										disabled: busy,
										"aria-label": t("actionEdit") + ": " + row.name,
										onClick: () => {
											openEdit(row);
										},
										children: t("actionEdit")
									}), row.builtIn ? row.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										disabled: busy,
										"aria-label": t("actionReset") + ": " + row.name,
										onClick: () => {
											remove(row);
										},
										children: t("actionReset")
									}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										disabled: busy,
										"aria-label": t("actionDelete") + ": " + row.name,
										onClick: () => {
											remove(row);
										},
										children: t("actionDelete")
									})]
								})
							]
						}, row.id))
					}),
					draft === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.formActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: busy,
							onClick: openAdd,
							children: t("actionAddModel")
						}), loadError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							disabled: busy,
							onClick: () => {
								load();
							},
							children: t("actionRetry")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						style: styles.form,
						onSubmit: (event) => {
							event.preventDefault();
							submit();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.formTitle,
								children: draft.mode === "add" ? t("addModelTitle") : t("editModelTitle", { id: draft.id })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.formFields,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.field,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												style: styles.fieldLabel,
												htmlFor: MODEL_FIELD_IDS.id,
												children: t("fieldId")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												id: MODEL_FIELD_IDS.id,
												value: draft.id,
												readOnly: draft.locked,
												disabled: busy,
												autoComplete: "off",
												spellCheck: false,
												"aria-invalid": idError !== void 0,
												"aria-describedby": idError === void 0 ? void 0 : MODEL_FIELD_IDS.id + "-error",
												onChange: (event) => {
													updateDraft("id", event.target.value);
												}
											}),
											idError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												id: MODEL_FIELD_IDS.id + "-error",
												style: styles.error,
												role: "alert",
												children: t(idError)
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.field,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												style: styles.fieldLabel,
												htmlFor: MODEL_FIELD_IDS.name,
												children: t("fieldName")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												id: MODEL_FIELD_IDS.name,
												value: draft.name,
												readOnly: draft.locked,
												disabled: busy,
												autoComplete: "off",
												spellCheck: false,
												"aria-invalid": nameError !== void 0,
												"aria-describedby": nameError === void 0 ? void 0 : MODEL_FIELD_IDS.name + "-error",
												onChange: (event) => {
													updateDraft("name", event.target.value);
												}
											}),
											nameError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												id: MODEL_FIELD_IDS.name + "-error",
												style: styles.error,
												role: "alert",
												children: t(nameError)
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.fieldPair,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: styles.field,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													style: styles.fieldLabel,
													htmlFor: MODEL_FIELD_IDS.contextWindow,
													children: t("fieldContextWindow")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
													id: MODEL_FIELD_IDS.contextWindow,
													value: draft.contextWindow,
													disabled: busy,
													inputMode: "numeric",
													autoComplete: "off",
													"aria-invalid": contextWindowError !== void 0,
													"aria-describedby": joinIds(draft.locked && draft.defaultContextWindow !== null ? MODEL_FIELD_IDS.contextWindow + "-default" : void 0, contextWindowError === void 0 ? void 0 : MODEL_FIELD_IDS.contextWindow + "-error"),
													onChange: (event) => {
														updateDraft("contextWindow", event.target.value);
													}
												}),
												draft.locked && draft.defaultContextWindow !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													id: MODEL_FIELD_IDS.contextWindow + "-default",
													style: styles.hint,
													children: t("builtInDefault", { value: draft.defaultContextWindow.toLocaleString() })
												}) : null,
												contextWindowError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													id: MODEL_FIELD_IDS.contextWindow + "-error",
													style: styles.error,
													role: "alert",
													children: t(contextWindowError)
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: styles.field,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													style: styles.fieldLabel,
													htmlFor: MODEL_FIELD_IDS.maxTokens,
													children: t("fieldMaxTokens")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
													id: MODEL_FIELD_IDS.maxTokens,
													value: draft.maxTokens,
													disabled: busy,
													inputMode: "numeric",
													autoComplete: "off",
													"aria-invalid": maxTokensError !== void 0,
													"aria-describedby": joinIds(draft.locked && draft.defaultMaxTokens !== null ? MODEL_FIELD_IDS.maxTokens + "-default" : void 0, maxTokensError === void 0 ? void 0 : MODEL_FIELD_IDS.maxTokens + "-error"),
													onChange: (event) => {
														updateDraft("maxTokens", event.target.value);
													}
												}),
												draft.locked && draft.defaultMaxTokens !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													id: MODEL_FIELD_IDS.maxTokens + "-default",
													style: styles.hint,
													children: t("builtInDefault", { value: draft.defaultMaxTokens.toLocaleString() })
												}) : null,
												maxTokensError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													id: MODEL_FIELD_IDS.maxTokens + "-error",
													style: styles.error,
													role: "alert",
													children: t(maxTokensError)
												})
											]
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.formActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "submit",
									variant: "primary",
									disabled: busy,
									children: t("actionSave")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									variant: "ghost",
									disabled: busy,
									onClick: closeDraft,
									children: t("actionCancel")
								})]
							})
						]
					})
				]
			});
		}
		const NS = "settings.openai-oauth";
		const inject = ["slots", "locale"];
		/** Register bilingual copy and the dedicated settings page. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "openai-oauth: client copy");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-oauth",
				order: 11,
				label: () => t("nav"),
				inject: () => ({ t })
			}, OpenAiOAuthSection));
		}
		//#endregion
		exports.OpenAiOAuthSection = OpenAiOAuthSection;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
