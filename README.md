<p align="center">
  <img src="docs/assets/readme-header.svg" width="100%" alt="dsh-openai-oauth — OpenAI OAuth community plugin for DeepSeek Harness">
</p>

<h1 align="center">dsh-openai-oauth</h1>

<p align="center"><strong>OpenAI OAuth for DeepSeek Harness</strong></p>

<p align="center">English | <a href="README.zh.md">中文</a></p>

Sign in to ChatGPT from DeepSeek Harness and use available Codex models without an OpenAI API key or Codex CLI. The plugin keeps the standard DSH sessions, tools, permissions, and model selector.

## Features

- Browser login with PKCE or Device Code login
- Web settings and a headless login command
- Automatic token refresh
- Codex models in the standard DSH model selector
- A model editor in Settings: add your own models, or override a built-in model's context window and maximum output
- Credentials stored locally under the Harness home

## Requirements

- DeepSeek Harness `0.1.7-rc.2` or `0.2.0-rc.2`
- Node.js `^22.19.0` or `>=24.0.0`
- `pnpm` on `PATH`
- A ChatGPT account with Codex access

Version `0.1.0` supports macOS and Linux. Windows support is not included yet.

## Install

### Install with an Agent (recommended)

Give this address to an Agent and ask it to follow the runbook:

`https://raw.githubusercontent.com/AdonisSheldon/dsh-openai-oauth/main/AGENTS.md`

When it finishes, you only need to approve any DSH restart and complete the ChatGPT login yourself.

### Install with DSH

After the package is published:

```sh
dsh plugin --profile web add dsh-openai-oauth@0.1.0
dsh --profile web --dump-config
```

### Install from the current checkout

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.1.0.tgz
dsh --profile web --dump-config
```

Restart a running DSH Web process after installation.

## Login and use

1. Open **Settings → OpenAI OAuth**.
2. Choose **Browser login** or **Device Code**.
3. Sign in with a ChatGPT account that has Codex access.
4. Open **Models** and select an `openai-codex` model.
5. Optional: add or override models in the same settings section — see [Model list](#model-list).

Browser login waits for a callback on `127.0.0.1:1455`. Use Device Code when that port is unavailable or the browser is on another machine.

For a headless profile:

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.1.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

The command asks which login method to use. Non-interactive terminals must pass `--browser` or `--device-code`.

## Model list

**Settings → OpenAI OAuth → Models** lists every model of the `openai-codex` provider together with the entries you added. Both kinds take effect on the next request; no DSH restart is needed.

- **Add model** stores a model the shipped catalog does not know. Give it an id, an optional display name, a context window, and a maximum output.
- **Edit** on a built-in row stores only that model's context window and maximum output; every other field stays as shipped. **Reset** restores the shipped values.
- Custom models inherit the built-in base reasoning levels (low, medium, high, xhigh) and accept text and image input.
- Limits: an id is 1–64 characters of letters, digits, `.`, `_`, `:` or `-` starting with a letter or digit; a context window is 1024–10000000; a maximum output is at least 1 and at most the context window; at most 64 custom models are stored.
- A model's maximum output is sent to OpenAI as `max_output_tokens`.
- Entries live in `$DSH_HOME/plugins/dsh-openai-oauth/models.json` (owner-only, written atomically). Removing that file returns the catalog to the shipped defaults.

## Update and uninstall

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

Restart DSH after installing, updating, or removing the plugin. Login, logout, and token refresh do not require a restart.

Sign out in **Settings → OpenAI OAuth** before uninstalling if the stored credential should also be deleted. Uninstalling the package otherwise preserves it.

## Development checks

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`check` validates types, regenerates the committed build artifacts, and runs regression tests without real credentials or API requests. Tests cover `role: "tool"` results, tool-call IDs, HTTP error classification, the model catalog, and the model overlay (validation, persistence, and the maximum-output request field).

Development dependencies and CI target DSH `0.2.0-rc.2`. The rc.8 tool-result blocks and `CallId` API are no longer supported.

## Notes

- This connects a ChatGPT account to the Codex model provider; it does not create an OpenAI API key.
- The Web integration supports only a local DSH Host bound to `127.0.0.1`.
- Credentials are stored unencrypted at `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`.
- The shipped catalog includes `gpt-6-astra` and `gpt-6.1-sol`; actual model availability and quota depend on the signed-in account. A catalog entry does not grant access.
- OpenAI may change the Codex OAuth protocol independently of this plugin.
- This is an unofficial community project and is not affiliated with or endorsed by OpenAI or DeepSeek AI.

See [SECURITY.md](SECURITY.md) for security reporting and deployment notes.

[MIT](LICENSE)
