/** Self-contained OpenAI Codex OAuth bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-attachment'
import { createModels } from '@earendil-works/pi-ai'
import type { AuthInteraction, MutableModels, OAuthAuth, Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { OpenAiCodexAdapter } from './adapter.js'
import { AuthController } from './auth-controller.js'
import { OPENAI_CODEX_PROVIDER, SecureCredentialStore } from './credential-store.js'
import { oauthRoute } from './oauth-http.js'

export { OpenAiCodexAdapter } from './adapter.js'
export type { OpenAiCodexAdapterOptions, OpenAiCodexModels } from './adapter.js'
export { AuthController, AuthControllerError } from './auth-controller.js'
export type { AuthStatus, LoginMethod, PendingStatus } from './auth-controller.js'
export { CredentialStoreError, OPENAI_CODEX_PROVIDER, SecureCredentialStore } from './credential-store.js'
export { OAUTH_ROUTE_PATH } from './oauth-http.js'

/** Cordis plugin identity. */
export const name = 'llm-openai-codex-oauth'
/** The LLM registry is required; Web and attachments are optional profile capabilities. */
export const inject = ['llm']

export interface PluginRuntime {
  credentials: SecureCredentialStore
  models: MutableModels
  controller: AuthController
  adapter: OpenAiCodexAdapter
}

export interface CreatePluginRuntimeOptions {
  dshHome?: string
  /** Test or embedding override for the provider-owned OAuth operation. */
  login?: (interaction: AuthInteraction) => ReturnType<OAuthAuth['login']>
  attachments?: () => import('@deepseek-ai/dsh-attachment').AttachmentStore | undefined
}

function oauthOf(provider: Provider): OAuthAuth {
  const oauth = provider.auth.oauth
  if (oauth === undefined) throw new Error('openai-codex provider does not expose OAuth')
  return oauth
}

/** Construct the shared credential, OAuth, model, and adapter runtime. */
export function createPluginRuntime(options: CreatePluginRuntimeOptions = {}): PluginRuntime {
  const credentials = new SecureCredentialStore(resolveDshHome(options.dshHome))
  const models = createModels({ credentials })
  const provider = openaiCodexProvider()
  models.setProvider(provider)
  const login = options.login ?? (interaction => oauthOf(provider).login(interaction))
  const controller = new AuthController(credentials, { login })
  const adapter = new OpenAiCodexAdapter(models, {
    ...options.attachments === undefined ? {} : { attachments: options.attachments },
  })
  return { credentials, models, controller, adapter }
}

/** Refuse the unsupported remotely reachable Web posture at plugin load. */
export function assertLocalWebHost(host: WebServer['host']): void {
  if (host !== '127.0.0.1') {
    throw new Error('dsh-openai-codex-oauth: Web OAuth supports only a loopback Host bound to 127.0.0.1')
  }
}

/** Register the direct adapter and optional local Web control route as one reversible effect. */
export function apply(ctx: Context): void {
  const runtime = createPluginRuntime({ attachments: () => ctx.get('attachments') })
  ctx.effect(() => {
    const disposeAdapter = ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], runtime.adapter)
    let disposeRoute = (): void => {}
    try {
      const web = ctx.get('webServer')
      if (web !== undefined) {
        assertLocalWebHost(web.host)
        disposeRoute = web.register(oauthRoute(runtime.controller, async () => (
          await runtime.adapter.listModels(OPENAI_CODEX_PROVIDER)
        ).map(model => ({ id: model.id, name: model.name }))))
      }
    } catch (error) {
      disposeAdapter()
      throw error
    }
    return async () => {
      disposeRoute()
      disposeAdapter()
      await runtime.controller.dispose()
    }
  }, 'dsh-openai-codex-oauth: adapter and local route')
}
