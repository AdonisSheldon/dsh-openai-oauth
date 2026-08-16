// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ButtonHTMLAttributes } from 'react'
import { OpenAiOAuthSection } from '../src/client/index.js'
import { en, type OAuthLocaleKey } from '../src/client/locales.js'
import { OAUTH_ROUTE_PATH } from '../src/protocol.js'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const t = (key: OAuthLocaleKey): string => en[key]

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant = 'ghost', ...props }: { variant?: string } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" className={`dsh-button-${variant}`} {...props} />
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OpenAI OAuth settings section', () => {
  it('uses Harness-styled action buttons', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ state: 'disconnected' })))
    render(<OpenAiOAuthSection close={() => {}} t={t} />)

    await screen.findByText('Not connected')
    expect(screen.getByRole('button', { name: 'Refresh status' }).className).not.toBe('')
  })

  it('does not repeat the provider model catalog in OAuth settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ state: 'disconnected' })))
    render(<OpenAiOAuthSection close={() => {}} t={t} />)

    await screen.findByText('Not connected')
    expect(screen.queryByText('Available models')).toBeNull()
  })

  it('makes Browser and Device Code explicit choices and presents device instructions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ state: 'disconnected' }))
      .mockResolvedValueOnce(response({
        state: 'pending', attemptId: 'attempt-1', method: 'device_code',
        deviceCode: {
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://auth.openai.com/codex/device',
          expiresAt: Date.now() + 900_000,
        },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<OpenAiOAuthSection close={() => {}} t={t} />)
    await screen.findByText('Not connected')

    expect((screen.getByRole('radio', { name: /Browser login/ }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: /Device Code/ }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('ABCD-EFGH')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open verification page' }).getAttribute('href'))
      .toBe('https://auth.openai.com/codex/device')
    const start = fetchMock.mock.calls[1]!
    expect(start[0]).toBe(`${OAUTH_ROUTE_PATH}/start`)
    expect(JSON.parse(String((start[1] as RequestInit).body))).toEqual({ method: 'device_code' })
  })

  it('opens only the trusted Browser authorization URL returned by the Host', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ state: 'disconnected' }))
      .mockResolvedValueOnce(response({
        state: 'pending', attemptId: 'attempt-2', method: 'browser',
        browser: { authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=public', callback: 'waiting' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const popup = { opener: window, location: { href: 'about:blank' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const user = userEvent.setup()
    render(<OpenAiOAuthSection close={() => {}} t={t} />)
    await screen.findByText('Not connected')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByText('Waiting for the loopback callback…')
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    expect(popup.location.href).toBe('https://auth.openai.com/oauth/authorize?state=public')
    expect(screen.getByRole('link', { name: 'Continue in browser' }).getAttribute('href'))
      .toBe('https://auth.openai.com/oauth/authorize?state=public')
  })

  it('renders connected status and performs explicit logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ state: 'connected' }))
      .mockResolvedValueOnce(response({ state: 'disconnected' }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<OpenAiOAuthSection close={() => {}} t={t} />)

    expect(await screen.findByText('Connected')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(`${OAUTH_ROUTE_PATH}/logout`, expect.objectContaining({
        method: 'POST', body: '{}',
      }))
    })
    expect(await screen.findByText('Not connected')).toBeDefined()
  })

  it('shows fixed Host errors as an accessible alert', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ state: 'disconnected' }))
      .mockResolvedValueOnce(response({
        error: { code: 'BROWSER_CALLBACK_UNAVAILABLE', message: 'Browser callback port 1455 is unavailable. Retry after freeing it or choose Device Code.' },
      }, 502))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    render(<OpenAiOAuthSection close={() => {}} t={t} />)
    await screen.findByText('Not connected')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Browser callback port 1455 is unavailable')
  })
})
