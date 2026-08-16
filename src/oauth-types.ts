/** OAuth credential persisted only by this plugin. */
export interface OAuthCredential {
  type: 'oauth'
  access: string
  refresh: string
  expires: number
  accountId: string
}

/** Public OAuth progress emitted to the local controller. */
export type AuthEvent =
  | { type: 'info'; message: string }
  | { type: 'progress'; message: string }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
    type: 'device_code'
    userCode: string
    verificationUri: string
    intervalSeconds?: number
    expiresInSeconds?: number
  }

/** Prompt requested by the plugin-owned OAuth implementation. */
export type AuthPrompt =
  | {
    type: 'select'
    message: string
    options: readonly { id: string; label: string }[]
  }
  | {
    type: 'manual_code'
    message: string
    placeholder?: string
    signal?: AbortSignal
  }

/** UI-independent interaction used by browser and device-code login. */
export interface AuthInteraction {
  signal?: AbortSignal
  prompt(prompt: AuthPrompt): Promise<string>
  notify(event: AuthEvent): void
}

/** Credential metadata safe to expose without secret fields. */
export interface CredentialInfo {
  providerId: string
  type: OAuthCredential['type']
}

/** Persistent credential operations required by the plugin runtime. */
export interface CredentialStore {
  read(providerId: string): Promise<OAuthCredential | undefined>
  list(): Promise<readonly CredentialInfo[]>
  modify(
    providerId: string,
    fn: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>,
  ): Promise<OAuthCredential | undefined>
  delete(providerId: string): Promise<void>
}
