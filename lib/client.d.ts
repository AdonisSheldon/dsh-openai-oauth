import { ReactNode } from "react";
import { Context } from "@deepseek-ai/cordis";
import { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";

//#region src/client/locales.d.ts
/** Copy owned by the OpenAI OAuth settings section. */
declare const en: {
  readonly nav: "OpenAI OAuth";
  readonly title: "OpenAI OAuth";
  readonly intro: "Connect ChatGPT account access to the OpenAI Codex model provider. Credentials stay in the local Harness Host.";
  readonly status: "Connection status";
  readonly loading: "Loading OAuth status…";
  readonly connected: "Connected";
  readonly pending: "Sign-in in progress";
  readonly disconnected: "Not connected";
  readonly failed: "Sign-in failed";
  readonly methodLegend: "Login method";
  readonly browser: "Browser login (recommended)";
  readonly browserHelp: "Uses PKCE and a one-time callback on 127.0.0.1:1455. This does not bind the account to the machine.";
  readonly device: "Device Code";
  readonly deviceHelp: "Use when the browser is on another machine or the local callback port is unavailable.";
  readonly signIn: "Sign in";
  readonly signOut: "Sign out";
  readonly cancel: "Cancel sign-in";
  readonly refresh: "Refresh status";
  readonly browserWaiting: "Waiting for the loopback callback…";
  readonly browserWaitingHelp: "Finish sign-in in the OpenAI window. This page updates automatically.";
  readonly continueBrowser: "Continue in browser";
  readonly deviceInstructions: "Open the verification page and enter this code:";
  readonly copyCode: "Copy device code";
  readonly copiedCode: "Device code copied";
  readonly copyHint: "Click to copy";
  readonly copied: "Copied";
  readonly copyFailed: "Could not copy the device code. Copy it manually.";
  readonly openVerification: "Open verification page";
  readonly expires: "This code expires at {time}.";
  readonly requestFailed: "The local Harness Host did not complete the OAuth request.";
  readonly modelsTitle: "Model list";
  readonly modelsIntro: "Built-in and custom Codex models. Custom entries extend the list; an override changes a built-in context window or output limit.";
  readonly modelsLoading: "Loading models…";
  readonly modelsEmpty: "No models are available.";
  readonly modelsWarning: "The stored model list could not be read ({code}). Built-in models are shown.";
  readonly actionRetry: "Retry";
  readonly badgeBuiltIn: "Built-in";
  readonly badgeCustom: "Custom";
  readonly badgeOverridden: "Overridden";
  readonly contextWindowLabel: "Context window";
  readonly maxTokensLabel: "Max output tokens";
  readonly actionEdit: "Edit";
  readonly actionDelete: "Delete";
  readonly actionReset: "Reset";
  readonly actionAddModel: "Add model";
  readonly addModelTitle: "Add a model";
  readonly editModelTitle: "Edit {id}";
  readonly fieldId: "Model id";
  readonly fieldName: "Display name (optional)";
  readonly fieldContextWindow: "Context window";
  readonly fieldMaxTokens: "Max output tokens";
  readonly builtInDefault: "Built-in default: {value}";
  readonly actionSave: "Save";
  readonly actionCancel: "Cancel";
  readonly validationId: "Use 1–64 characters — letters, digits, dot, underscore, colon or dash — starting with a letter or digit.";
  readonly validationName: "Use at most 64 characters with no control characters.";
  readonly validationContextWindow: "Enter a whole number from 1024 to 10000000.";
  readonly validationMaxTokens: "Enter a whole number from 1 to the context window.";
};
type OAuthLocaleKey = keyof typeof en;
//#endregion
//#region src/client/index.d.ts
interface OpenAiOAuthSectionInjected {
  t: (key: OAuthLocaleKey, params?: Record<string, string | number>) => string;
}
type OpenAiOAuthSectionProps = SettingsSectionOwnerProps & OpenAiOAuthSectionInjected;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dedicated OpenAI OAuth settings copy. */
    'settings.openai-oauth': OAuthLocaleKey;
  }
}
/** Dedicated settings section for the plugin-owned OAuth state machine. */
declare function OpenAiOAuthSection({
  t
}: OpenAiOAuthSectionProps): ReactNode;
declare const inject: string[];
/** Register bilingual copy and the dedicated settings page. */
declare function apply(ctx: Context): void;
//#endregion
export { OpenAiOAuthSection, OpenAiOAuthSectionInjected, OpenAiOAuthSectionProps, apply, inject };