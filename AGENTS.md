# dsh-openai-oauth Agent installation runbook

Follow this runbook to add the standalone `dsh-openai-oauth` package to an existing DeepSeek Harness installation. The default destination is the `web` profile; use a different profile only when the user names one.

## Expected result

The task is complete when all of the following are true:

- the requested profile contains one `dsh-openai-oauth` installation;
- the composed DSH configuration includes the plugin;
- no Harness source file, other plugin, or other profile was changed;
- the user knows whether DSH must be restarted and where to finish OAuth login.

## Operating limits

- Treat DeepSeek Harness and this plugin as separate projects. Do not copy plugin files into Harness or edit Harness configuration and package-management files by hand.
- Leave profiles, unrelated plugins, and previously saved credentials intact.
- Never display OAuth tokens, authorization callbacks, account identifiers, or credential-file contents.
- The user must complete ChatGPT authentication. Do not authenticate on their behalf.
- Ask before stopping or restarting a running DSH process.

## Environment check

Confirm these prerequisites before making changes:

- macOS or Linux;
- DeepSeek Harness `0.1.0-rc.8`;
- Node.js `^22.19.0` or `>=24.0.0`;
- `pnpm` available on `PATH`.

Inspect the Node.js and pnpm versions and locate a usable DSH command. Prefer a globally available `dsh`. When operating inside a DeepSeek Harness source checkout, use `pnpm dsh` for every DSH invocation. Report an unsupported platform or version instead of attempting to alter Harness for compatibility.

## Registration and inspection

For the default `web` profile, run:

```sh
dsh plugin --profile web add github:AdonisSheldon/dsh-openai-oauth
dsh --profile web --dump-config
```

Substitute the user-selected profile when necessary. Substitute `pnpm dsh` for `dsh` when using the source-checkout launcher. When the user specifies a tag or commit, add `#<tag-or-commit>` to the GitHub package reference.

Inspect the resulting configuration and confirm that `dsh-openai-oauth` occurs once. Do not count a partial download or a package-manager entry as successful registration.

## User handoff

If port `3080` already belongs to a running DSH Web instance, do not launch another instance. Installation requires one DSH restart to load the new plugin; perform it only with the user's approval.

After DSH reloads, direct the user to **Settings -> OpenAI OAuth**. They can choose **Browser login** or **Device Code** and then authenticate their own ChatGPT account.

Report the profile, package reference, configuration-check result, and restart status.

## Unsuccessful installation

Identify the command that failed and return its sanitized error output. Stop without modifying Harness source, deleting profiles, removing unrelated plugins, expanding filesystem access, weakening certificate checks, or approving unrelated lifecycle scripts.
