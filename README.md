# dsh-openai-oauth

English | [中文](README.zh.md)

Sign in to ChatGPT from DeepSeek Harness and use available Codex models without an OpenAI API key or Codex CLI. The plugin keeps the standard DSH sessions, tools, permissions, and model selector.

## Features

- Browser login with PKCE or Device Code login
- Web settings and a headless login command
- Automatic token refresh
- Codex models in the standard DSH model selector
- Credentials stored locally under the Harness home

## Requirements

- DeepSeek Harness `0.1.0-rc.6`
- Node.js `^22.19.0` or `>=24.0.0`
- `pnpm` on `PATH`
- A ChatGPT account with Codex access

Version `0.1.0` supports macOS and Linux. Windows support is not included yet.

## Install

### From the current checkout

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.1.0.tgz
dsh --profile web --dump-config
```

### From npm

After the package is published:

```sh
dsh plugin --profile web add dsh-openai-oauth@0.1.0
dsh --profile web --dump-config
```

### Install with a coding agent

Copy the following prompt to an agent that can use your terminal. The commands use a globally installed `dsh`; when the agent is working from a DeepSeek Harness source checkout, it should substitute `pnpm dsh` consistently.

```text
Install dsh-openai-oauth into the DeepSeek Harness web profile as an external plugin.

Requirements:
1. Do not modify or commit files in the DeepSeek Harness source tree. Do not copy this plugin into that repository and do not manually edit its cordis.yml or profile package files.
2. Check `node --version`, `pnpm --version`, and the available DSH launcher. This plugin requires Node.js ^22.19.0 or >=24.0.0 and DeepSeek Harness 0.1.0-rc.6. If the installed Harness version differs, stop and report the mismatch instead of patching Harness.
3. Use `dsh` when it is installed globally. If only a Harness source checkout is available, use `pnpm dsh` for every DSH command.
4. Install with `<dsh-launcher> plugin --profile web add github:AdonisSheldon/dsh-openai-oauth`. If I supplied a tag or commit, append it to the GitHub spec as `#<tag-or-commit>`. Do not approve unrelated install scripts or broaden filesystem permissions.
5. Verify with `<dsh-launcher> web --dump-config` and confirm that the output contains `dsh-openai-oauth`.
6. If DSH Web is already running, do not start a second process on port 3080. Restart only a DSH process that you started or control; otherwise tell me that one restart is required.
7. Do not sign in to ChatGPT for me or print credentials. After installation, tell me to open Settings -> OpenAI OAuth, choose Browser login or Device Code, and complete the login myself.
8. If installation or verification fails, return the exact command and error. Do not work around the failure by changing DeepSeek Harness source code.

Finish with the installed profile, package source, verification result, and whether a restart is still required.
```

Restart a running DSH Web process after installation.

## Login and use

1. Open **Settings → OpenAI OAuth**.
2. Choose **Browser login** or **Device Code**.
3. Sign in with a ChatGPT account that has Codex access.
4. Open **Models** and select an `openai-codex` model.

Browser login waits for a callback on `127.0.0.1:1455`. Use Device Code when that port is unavailable or the browser is on another machine.

For a headless profile:

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.1.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

The command asks which login method to use. Non-interactive terminals must pass `--browser` or `--device-code`.

## Update and uninstall

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

Restart DSH after installing, updating, or removing the plugin. Login, logout, and token refresh do not require a restart.

Sign out in **Settings → OpenAI OAuth** before uninstalling if the stored credential should also be deleted. Uninstalling the package otherwise preserves it.

## Notes

- This connects a ChatGPT account to the Codex model provider; it does not create an OpenAI API key.
- The Web integration supports only a local DSH Host bound to `127.0.0.1`.
- Credentials are stored unencrypted at `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`.
- Model availability and quota depend on the signed-in account.
- OpenAI may change the Codex OAuth protocol independently of this plugin.
- This is an unofficial community project and is not affiliated with or endorsed by OpenAI or DeepSeek AI.

See [SECURITY.md](SECURITY.md) for security reporting and deployment notes.

[MIT](LICENSE)
