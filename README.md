# dsh-openai-codex-oauth

English | [中文](README.zh.md)

An unofficial, self-contained DeepSeek Harness plugin that exposes pi-ai's `openai-codex` models through ChatGPT account OAuth. It keeps the Harness agent loop, tools, prompts, session replay, and model selection; it does not start Codex App Server or create a second provider-owned conversation.

This is ChatGPT account authorization for the Codex model provider. It is not OpenAI API OAuth, does not configure the ordinary `openai` provider, and cannot grant models or quota absent from the signed-in account.

## Compatibility

Version `0.1.0` targets this exact published set:

- DeepSeek Harness `0.1.0-rc.6`
- Cordis `4.0.1`
- `@earendil-works/pi-ai` `0.82.1`
- Node.js `^22.19.0` or `>=24.0.0`

The Web integration supports only a local Harness Host bound to `127.0.0.1`. Remote, proxied, container-forwarded, and Electron transports are not supported by this release. The direct login command remains available when the Web profile is not running.

## Standalone installation contract

The plugin uses only the public runtime exported by the compatible DeepSeek Harness release. It does not patch, replace, or require changes to the Harness source tree, agent loop, or published packages. The normal `dsh plugin add` command changes only the selected user's profile state so Harness can resolve the package and apply its `cordis.patch.yml` layer.

Harness supplies Cordis, pi-ai, React, and DSH runtime packages at their exact compatible versions. The plugin installs only its owned file-locking dependency, ships reviewed `lib/` output, and defines no install lifecycle script. Consequently, installing the tarball or a pinned GitHub commit requires neither a source checkout nor package-manager build approval. CI verifies this contract by packing the repository, installing that tarball into a clean published DSH `0.1.0-rc.6` host, booting the Web profile, querying the OAuth status route, and uninstalling the package.

## Install

Install a released package into the Web profile:

```sh
dsh plugin --profile web add dsh-openai-codex-oauth@0.1.0
dsh --profile web --dump-config
dsh --profile web
```

Before an npm release exists, build a tarball from a trusted checkout and install that immutable artifact:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add /absolute/path/dsh-openai-codex-oauth-0.1.0.tgz
```

A GitHub installation also works because this repository commits `lib/`; pin a reviewed commit instead of a moving branch:

```sh
dsh plugin --profile web add github:YOUR_ACCOUNT/dsh-openai-codex-oauth#COMMIT_SHA
```

Installation changes the profile composition. Restart an already-running Harness process once after installing, updating, or removing the package. Login, logout, cancellation, and status refresh do not require a restart.

## Sign in from the Web UI

Open the **OpenAI OAuth** settings section and choose one method before selecting **Sign in**:

- **Browser login (recommended)** starts a PKCE flow, opens an OpenAI authorization URL, and waits for a one-time callback on `127.0.0.1:1455`. The callback is not machine binding. If port `1455` is occupied or the browser runs on another machine, use Device Code.
- **Device Code** displays an OpenAI verification URL, one-time user code, and expiry while the local Host polls for completion. Tokens never pass through the browser UI.

After the status becomes **Connected**, the stock Models settings can discover the registered `openai-codex` models. Select a model there as usual. Model availability depends on the OpenAI account.

## Sign in from a terminal

Run the installed command from the profile. With the default Harness home:

```sh
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-codex-login
```

The interactive command asks for Browser or Device Code. Scripts and non-interactive terminals must choose explicitly:

```sh
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-codex-login --browser
pnpm --dir ~/.dsh/profiles/web exec dsh-openai-codex-login --device-code
```

When `DSH_HOME` is customized, use its matching profile directory and keep that environment variable set so the command and Harness share the same credential file.

## Credential and network behavior

Credentials are stored in `$DSH_HOME/plugins/dsh-openai-codex-oauth/credentials.json` (`~/.dsh` is the default Harness home). The plugin enforces an owner-only directory and file on supported POSIX filesystems, refuses symbolic-link credential targets, serializes cross-process updates, and atomically replaces the versioned file. The file is not encrypted at rest; protect the operating-system account and Harness home.

OAuth credentials and model requests are sent to OpenAI by pi-ai. The Web route returns only redacted connection state, model identifiers, the Browser authorization URL, or Device Code instructions. It rejects non-loopback requests and cross-origin mutations and does not enable CORS. Session logs contain model-visible conversation data and replay metadata, never OAuth credentials.

See [SECURITY.md](SECURITY.md) before reporting a vulnerability or deploying the plugin.

## Limitations

- Browser login requires the fixed pi-ai callback port `1455`; choose Device Code when it is unavailable.
- OpenAI can change the unofficial Codex OAuth protocol or account policy independently of this plugin.
- `maxTokens` and stop sequences are rejected because pi-ai's Codex transport does not expose faithful request controls for them.
- Reasoning choices list only values the selected pi-ai model supports; this release does not advertise an `off` setting that the transport cannot guarantee.

## Remove

Sign out in **OpenAI OAuth** settings first if the credential must be deleted, then remove the bundle and restart the running Harness process:

```sh
dsh plugin --profile web remove dsh-openai-codex-oauth
```

Removing the package withdraws the adapter, route, and settings section but intentionally preserves any plugin-owned credential that was not explicitly deleted. This prevents an uninstall from silently destroying account state.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

Built `lib/` files are committed so pinned GitHub installs execute reviewed artifacts without an install-time build script.
