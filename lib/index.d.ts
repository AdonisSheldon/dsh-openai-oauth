import { Api, AssistantMessageEvent, AuthInteraction, Credential, CredentialInfo, CredentialStore, Model, ModelsSimpleStreamOptions, MutableModels, OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { GenerateOptions, LlmAdapter, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";

//#region src/adapter.d.ts
/** Minimum pi-ai collection face used by the route-specific adapter. */
interface OpenAiCodexModels {
  getModels(provider?: string): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
  streamSimple(model: Model<Api>, context: import('@earendil-works/pi-ai').Context, options?: ModelsSimpleStreamOptions): AsyncIterable<AssistantMessageEvent>;
}
interface OpenAiCodexAdapterOptions {
  /** Resolve the optional durable image service at request time. */
  attachments?: () => AttachmentStore | undefined;
}
/** Route-specific adapter over pi-ai's credential-aware Models collection. */
declare class OpenAiCodexAdapter extends LlmAdapter {
  private readonly models;
  private readonly options;
  /**
   * @param models - collection containing pi-ai's built-in openai-codex provider.
   * @param options - optional Harness capability resolvers.
   */
  constructor(models: OpenAiCodexModels, options?: OpenAiCodexAdapterOptions);
  providerInfo(provider: string): LlmProviderInfo;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//#endregion
//#region src/auth-controller.d.ts
/** Login methods presented by pi-ai's OpenAI Codex OAuth provider. */
type LoginMethod = 'browser' | 'device_code';
interface RedactedAuthError {
  code: string;
  message: string;
}
interface DisconnectedStatus {
  state: 'disconnected';
}
interface ConnectedStatus {
  state: 'connected';
}
interface BrowserPendingStatus {
  state: 'pending';
  attemptId: string;
  method: 'browser';
  browser: {
    authorizationUrl: string;
    callback: 'waiting';
  };
}
interface DeviceCodePendingStatus {
  state: 'pending';
  attemptId: string;
  method: 'device_code';
  deviceCode: {
    userCode: string;
    verificationUri: string;
    expiresAt: number;
  };
}
type PendingStatus = BrowserPendingStatus | DeviceCodePendingStatus;
interface FailedStatus {
  state: 'failed';
  error: RedactedAuthError;
  connectedBeforeAttempt: boolean;
}
/** Every redacted state exposed to the Host route and Client. */
type AuthStatus = DisconnectedStatus | ConnectedStatus | PendingStatus | FailedStatus;
/** Stable controller failure safe to translate at the local Host boundary. */
declare class AuthControllerError extends Error {
  readonly code: string;
  /**
   * @param code - stable failure code.
   * @param message - fixed text containing no upstream error detail.
   */
  constructor(code: string, message: string);
}
interface AuthControllerOptions {
  /** Run the provider-owned OAuth interaction and return its credential. */
  login: (interaction: AuthInteraction) => Promise<OAuthCredential>;
  /** Injectable clock for deterministic expiry projection. */
  now?: () => number;
}
/**
 * One dual-method OAuth state machine. It owns cancellation and persistence,
 * while pi-ai owns the OpenAI protocol and token exchange.
 */
declare class AuthController {
  private readonly credentials;
  private readonly options;
  private statusValue;
  private active;
  private latest;
  private disposed;
  private mutation;
  private readonly now;
  /**
   * @param credentials - plugin-owned persistent pi-ai credential store.
   * @param options - provider login operation and deterministic helpers.
   */
  constructor(credentials: CredentialStore, options: AuthControllerOptions);
  /** Return a detached synchronous view containing no credential fields. */
  snapshot(): AuthStatus;
  /** Reconcile the initial durable credential before returning redacted state. */
  status(): Promise<AuthStatus>;
  private exclusive;
  private settleReady;
  private pendingFromEvent;
  private interaction;
  private run;
  /** Start exactly the selected flow, returning once its public instructions exist. */
  start(method: LoginMethod): Promise<PendingStatus>;
  /** Await completion of the latest named attempt for a direct headless caller. */
  waitForAttempt(attemptId: string): Promise<AuthStatus>;
  /** Cancel only the named current attempt and await provider cleanup. */
  cancel(attemptId: string): Promise<AuthStatus>;
  /** Abort any attempt, then remove only the plugin-owned credential. */
  logout(): Promise<AuthStatus>;
  /** Abort and settle active provider work before plugin effects unwind. */
  dispose(): Promise<void>;
}
//#endregion
//#region src/credential-store.d.ts
/** The single pi-ai provider owned by this plugin. */
declare const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Stable storage failure with no credential or file contents in its message. */
declare class CredentialStoreError extends Error {
  readonly code: string;
  /**
   * @param code - stable diagnostic code safe to expose after route mapping.
   * @param message - fixed, redacted diagnostic text.
   */
  constructor(code: string, message: string);
}
/**
 * Owner-only, versioned pi-ai credential store rooted below one Harness home.
 * All writes and deletion are serialized by an OS-visible lock and replace the
 * credential file atomically.
 */
declare class SecureCredentialStore implements CredentialStore {
  private readonly dshHome;
  /** Plugin-owned state directory. */
  readonly stateDirectory: string;
  /** Versioned credential envelope path. */
  readonly credentialFile: string;
  /**
   * @param dshHome - resolved Harness home directory.
   */
  constructor(dshHome: string);
  private assertDirectory;
  private ensureStateDirectory;
  private readEnvelope;
  private withLock;
  private writeCredential;
  read(providerId: string): Promise<Credential | undefined>;
  list(): Promise<readonly CredentialInfo[]>;
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  delete(providerId: string): Promise<void>;
}
//#endregion
//#region src/protocol.d.ts
/** Exact local route family owned by this plugin. */
declare const OAUTH_ROUTE_PATH = "/api/plugins/openai-codex-oauth";
//#endregion
//#region src/index.d.ts
/** Cordis plugin identity. */
declare const name = "llm-openai-codex-oauth";
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
declare const inject: string[];
interface PluginRuntime {
  credentials: SecureCredentialStore;
  models: MutableModels;
  controller: AuthController;
  adapter: OpenAiCodexAdapter;
}
interface CreatePluginRuntimeOptions {
  dshHome?: string;
  /** Test or embedding override for the provider-owned OAuth operation. */
  login?: (interaction: AuthInteraction) => ReturnType<OAuthAuth['login']>;
  attachments?: () => import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined;
}
/** Construct the shared credential, OAuth, model, and adapter runtime. */
declare function createPluginRuntime(options?: CreatePluginRuntimeOptions): PluginRuntime;
/** Refuse the unsupported remotely reachable Web posture at plugin load. */
declare function assertLocalWebHost(host: WebServer['host']): void;
/** Register the direct adapter and activate the local route whenever a Web Host is present. */
declare function apply(ctx: Context): void;
//#endregion
export { AuthController, AuthControllerError, type AuthStatus, CreatePluginRuntimeOptions, CredentialStoreError, type LoginMethod, OAUTH_ROUTE_PATH, OPENAI_CODEX_PROVIDER, OpenAiCodexAdapter, type OpenAiCodexAdapterOptions, type OpenAiCodexModels, type PendingStatus, PluginRuntime, SecureCredentialStore, apply, assertLocalWebHost, createPluginRuntime, inject, name };