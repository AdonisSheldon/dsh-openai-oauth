import { GenerateOptions, LlmAdapter, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";

//#region src/models.d.ts
/** Reasoning levels accepted by OpenAI Codex models. */
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** The single wire API implemented by this plugin. */
type Api = 'openai-codex-responses' | 'dsh-foreign';
/** Plugin-owned model metadata used for routing and capability validation. */
interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input: ('text' | 'image')[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}
interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
}
interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}
interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}
interface ToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  api: Api;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  usage: Usage;
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  errorMessage?: string;
  timestamp: number;
}
type UserMessage = {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
};
type ToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
};
type CodexMessage = UserMessage | ToolResultMessage | AssistantMessage;
interface CodexTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
interface CodexContext {
  systemPrompt?: string;
  messages: CodexMessage[];
  tools?: CodexTool[];
}
interface ModelsSimpleStreamOptions {
  reasoning?: ThinkingLevel;
  temperature?: number;
  sessionId?: string;
  signal?: AbortSignal;
  maxRetries?: number;
  transformHeaders?: (headers: Readonly<Record<string, string | null>>) => Record<string, string | null>;
}
type AssistantMessageEvent = {
  type: 'start';
  partial: AssistantMessage;
} | {
  type: 'text_start';
  contentIndex: number;
  partial: AssistantMessage;
} | {
  type: 'text_delta';
  contentIndex: number;
  delta: string;
  partial: AssistantMessage;
} | {
  type: 'text_end';
  contentIndex: number;
  content: string;
  partial: AssistantMessage;
} | {
  type: 'thinking_start';
  contentIndex: number;
  partial: AssistantMessage;
} | {
  type: 'thinking_delta';
  contentIndex: number;
  delta: string;
  partial: AssistantMessage;
} | {
  type: 'thinking_end';
  contentIndex: number;
  content: string;
  partial: AssistantMessage;
} | {
  type: 'toolcall_start';
  contentIndex: number;
  partial: AssistantMessage;
} | {
  type: 'toolcall_delta';
  contentIndex: number;
  delta: string;
  partial: AssistantMessage;
} | {
  type: 'toolcall_end';
  contentIndex: number;
  toolCall: ToolCallContent;
  partial: AssistantMessage;
} | {
  type: 'done';
  reason: AssistantMessage['stopReason'];
  message: AssistantMessage;
} | {
  type: 'error';
  reason: AssistantMessage['stopReason'];
  error: AssistantMessage;
};
//#endregion
//#region src/adapter.d.ts
/** Minimum model collection used by the route-specific adapter. */
interface OpenAiCodexModels {
  getModels(provider?: string): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
  streamSimple(model: Model<Api>, context: CodexContext, options?: ModelsSimpleStreamOptions): AsyncIterable<AssistantMessageEvent>;
}
interface OpenAiCodexAdapterOptions {
  /** Resolve the optional durable image service at request time. */
  attachments?: () => AttachmentStore | undefined;
}
/** Route-specific adapter over the plugin-owned credential-aware model collection. */
declare class OpenAiCodexAdapter extends LlmAdapter {
  private readonly models;
  private readonly options;
  /**
   * @param models - plugin-owned OpenAI Codex model collection.
   * @param options - optional Harness capability resolvers.
   */
  constructor(models: OpenAiCodexModels, options?: OpenAiCodexAdapterOptions);
  providerInfo(provider: string): LlmProviderInfo;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//#endregion
//#region src/oauth-types.d.ts
/** OAuth credential persisted only by this plugin. */
interface OAuthCredential {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}
/** Public OAuth progress emitted to the local controller. */
type AuthEvent = {
  type: 'info';
  message: string;
} | {
  type: 'progress';
  message: string;
} | {
  type: 'auth_url';
  url: string;
  instructions?: string;
} | {
  type: 'device_code';
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
};
/** Prompt requested by the plugin-owned OAuth implementation. */
type AuthPrompt = {
  type: 'select';
  message: string;
  options: readonly {
    id: string;
    label: string;
  }[];
} | {
  type: 'manual_code';
  message: string;
  placeholder?: string;
  signal?: AbortSignal;
};
/** UI-independent interaction used by browser and device-code login. */
interface AuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
}
/** Credential metadata safe to expose without secret fields. */
interface CredentialInfo {
  providerId: string;
  type: OAuthCredential['type'];
}
/** Persistent credential operations required by the plugin runtime. */
interface CredentialStore {
  read(providerId: string): Promise<OAuthCredential | undefined>;
  list(): Promise<readonly CredentialInfo[]>;
  modify(providerId: string, fn: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>): Promise<OAuthCredential | undefined>;
  delete(providerId: string): Promise<void>;
}
//#endregion
//#region src/auth-controller.d.ts
/** Login methods presented by the plugin-owned OpenAI OAuth implementation. */
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
 * while the OAuth service owns the OpenAI protocol and token exchange.
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
   * @param credentials - plugin-owned persistent OAuth credential store.
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
//#region src/codex-models.d.ts
type CodexFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface CodexModelsOptions {
  fetch?: CodexFetch;
  now?: () => number;
  refresh: (credential: OAuthCredential, signal?: AbortSignal) => Promise<OAuthCredential>;
}
/** Credential-aware model collection and direct Codex Responses transport. */
declare class CodexModels {
  private readonly credentials;
  private readonly options;
  private readonly fetch;
  private readonly now;
  /**
   * @param credentials - plugin-owned credential persistence.
   * @param options - direct HTTP and refresh operations.
   */
  constructor(credentials: CredentialStore, options: CodexModelsOptions);
  /** Return models from the plugin's versioned catalog. */
  getModels(provider?: string): readonly Model[];
  /** Resolve one exact model owned by the provider route. */
  getModel(provider: string, id: string): Model | undefined;
  private credential;
  /** Stream one request through the ChatGPT Codex Responses endpoint. */
  streamSimple(model: Model, context: CodexContext, options?: ModelsSimpleStreamOptions): AsyncGenerator<AssistantMessageEvent>;
}
//#endregion
//#region src/credential-store.d.ts
/** The single provider owned by this plugin. */
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
 * Owner-only, versioned OAuth credential store rooted below one Harness home.
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
  read(providerId: string): Promise<OAuthCredential | undefined>;
  list(): Promise<readonly CredentialInfo[]>;
  modify(providerId: string, fn: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>): Promise<OAuthCredential | undefined>;
  delete(providerId: string): Promise<void>;
}
//#endregion
//#region src/openai-oauth.d.ts
type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface OpenAiOAuth {
  /** Run the explicitly selected browser or device-code flow. */
  login(interaction: AuthInteraction): Promise<OAuthCredential>;
  /** Exchange one refresh token for a complete replacement credential. */
  refresh(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential>;
}
interface OpenAiOAuthOptions {
  fetch?: OAuthFetch;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  waitForCallback?: (state: string, signal?: AbortSignal) => Promise<string>;
}
/** Create the plugin-owned OpenAI OAuth implementation. */
declare function createOpenAiOAuth(options?: OpenAiOAuthOptions): OpenAiOAuth;
//#endregion
//#region src/protocol.d.ts
/** Exact local route family owned by this plugin. */
declare const OAUTH_ROUTE_PATH = "/api/plugins/openai-oauth";
//#endregion
//#region src/index.d.ts
/** Cordis plugin identity. */
declare const name = "llm-openai-oauth";
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
declare const inject: string[];
interface PluginRuntime {
  credentials: SecureCredentialStore;
  models: CodexModels;
  controller: AuthController;
  adapter: OpenAiCodexAdapter;
}
interface CreatePluginRuntimeOptions {
  dshHome?: string;
  /** Test or embedding override for the plugin-owned OAuth operation. */
  login?: (interaction: AuthInteraction) => Promise<OAuthCredential>;
  attachments?: () => import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined;
}
/** Construct the shared credential, OAuth, model, and adapter runtime. */
declare function createPluginRuntime(options?: CreatePluginRuntimeOptions): PluginRuntime;
/** Refuse the unsupported remotely reachable Web posture at plugin load. */
declare function assertLocalWebHost(host: WebServer['host']): void;
/** Register the direct adapter and activate the local route whenever a Web Host is present. */
declare function apply(ctx: Context): void;
//#endregion
export { AuthController, AuthControllerError, type AuthStatus, CreatePluginRuntimeOptions, CredentialStoreError, type LoginMethod, OAUTH_ROUTE_PATH, OPENAI_CODEX_PROVIDER, OpenAiCodexAdapter, type OpenAiCodexAdapterOptions, type OpenAiCodexModels, type PendingStatus, PluginRuntime, SecureCredentialStore, apply, assertLocalWebHost, createOpenAiOAuth, createPluginRuntime, inject, name };