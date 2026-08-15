import { ReactNode } from "react";
import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
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
  readonly continueBrowser: "Continue in browser";
  readonly deviceInstructions: "Open the verification page and enter this code:";
  readonly openVerification: "Open verification page";
  readonly expires: "This code expires at {time}.";
  readonly models: "Available models";
  readonly noModels: "The provider model list will appear here.";
  readonly requestFailed: "The local Harness Host did not complete the OAuth request.";
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
    'settings.openai-codex-oauth': OAuthLocaleKey;
  }
}
/** Dedicated settings section for the plugin-owned OAuth state machine. */
declare function OpenAiOAuthSection({
  t
}: OpenAiOAuthSectionProps): ReactNode;
declare const inject: string[];
/** Register bilingual copy and the dedicated settings page. */
declare function apply(ctx: ClientContext): void;
//#endregion
export { OpenAiOAuthSection, OpenAiOAuthSectionInjected, OpenAiOAuthSectionProps, apply, inject };