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
			openVerification: "Open verification page",
			expires: "This code expires at {time}.",
			requestFailed: "The local Harness Host did not complete the OAuth request."
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
			openVerification: "打开验证页面",
			expires: "此代码将在 {time} 过期。",
			requestFailed: "本机 Harness Host 未能完成 OAuth 请求。"
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
			code: {
				display: "inline-block",
				padding: "4px 8px",
				borderRadius: 6,
				background: "var(--dsw-alias-bg-layer-3)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: 18,
				fontWeight: 600,
				letterSpacing: "0.08em",
				margin: "8px 0"
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
		/** Dedicated settings section for the plugin-owned OAuth state machine. */
		function OpenAiOAuthSection({ t }) {
			const [status, setStatus] = (0, react.useState)();
			const [method, setMethod] = (0, react.useState)("browser");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
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
			const connected = status?.state === "connected";
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											style: styles.code,
											children: status.deviceCode.userCode
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

//# sourceMappingURL=client.js.map