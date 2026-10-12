/** Self-contained OpenAI Codex OAuth bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-attachment'
import { OpenAiCodexAdapter } from './adapter.js'
import { AuthController } from './auth-controller.js'
import { CodexModels } from './codex-models.js'
import { OPENAI_CODEX_PROVIDER, SecureCredentialStore } from './credential-store.js'
import { CustomModelStore } from './model-store.js'
import { createOpenAiOAuth } from './openai-oauth.js'
import { oauthRoute } from './oauth-http.js'
import type { AuthInteraction, OAuthCredential } from './oauth-types.js'

export { OpenAiCodexAdapter } from './adapter.js'
export type { OpenAiCodexAdapterOptions, OpenAiCodexModels } from './adapter.js'
export { AuthController, AuthControllerError } from './auth-controller.js'
export type { AuthStatus, LoginMethod, PendingStatus } from './auth-controller.js'
export { resolveCatalog, resolveModelRows, validateModelDraft } from './catalog.js'
export type { ModelRow, StoredModel } from './catalog.js'
export { CredentialStoreError, OPENAI_CODEX_PROVIDER, SecureCredentialStore } from './credential-store.js'
export { CustomModelStore, ModelStoreError } from './model-store.js'
export { createOpenAiOAuth } from './openai-oauth.js'
export { OAUTH_ROUTE_PATH } from './oauth-http.js'

/** Cordis plugin identity. */
export const name = 'llm-openai-oauth'
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
export const inject = ['llm']

export interface PluginRuntime {
  credentials: SecureCredentialStore
  store: CustomModelStore
  models: CodexModels
  controller: AuthController
  adapter: OpenAiCodexAdapter
}

export interface CreatePluginRuntimeOptions {
  dshHome?: string
  /** Test or embedding override for the plugin-owned OAuth operation. */
  login?: (interaction: AuthInteraction) => Promise<OAuthCredential>
  attachments?: () => import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
}

/** Construct the shared credential, OAuth, model, and adapter runtime. */
export function createPluginRuntime(options: CreatePluginRuntimeOptions = {}): PluginRuntime {
  const dshHome = resolveDshHome(options.dshHome)
  const credentials = new SecureCredentialStore(dshHome)
  const store = new CustomModelStore(dshHome)
  const oauth = createOpenAiOAuth()
  const models = new CodexModels(credentials, {
    refresh: (credential, signal) => oauth.refresh(credential, signal),
    store,
  })
  const login = options.login ?? (interaction => oauth.login(interaction))
  const controller = new AuthController(credentials, { login })
  const adapter = new OpenAiCodexAdapter(models, {
    ...options.attachments === undefined ? {} : { attachments: options.attachments },
  })
  return { credentials, store, models, controller, adapter }
}

/** Refuse the unsupported remotely reachable Web posture at plugin load. */
export function assertLocalWebHost(host: WebServer['host']): void {
  if (host !== '127.0.0.1') {
    throw new Error('dsh-openai-oauth: Web OAuth supports only a loopback Host bound to 127.0.0.1')
  }
}

/** Register the direct adapter and activate the local route whenever a Web Host is present. */
export function apply(ctx: Context): void {
  const runtime = createPluginRuntime({ attachments: () => ctx.get('attachments') })
  ctx.effect(() => {
    const registration = ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], runtime.adapter)
    const stopWatching = runtime.store.onChange(() => {
      try {
        registration.replace([OPENAI_CODEX_PROVIDER])
      } catch {
        // A catalog refresh is best-effort; the stored model is already committed.
      }
    })
    return async () => {
      stopWatching()
      registration()
      await runtime.controller.dispose()
    }
  }, 'dsh-openai-oauth: adapter and controller')
  ctx.inject(['webServer'], (routeCtx) => {
    assertLocalWebHost(routeCtx.webServer.host)
    return routeCtx.webServer.register(oauthRoute(runtime.controller, runtime.store))
  })
}
