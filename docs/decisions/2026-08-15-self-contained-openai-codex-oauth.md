# Self-contained OpenAI Codex OAuth bundle

Status: accepted

## Context

DeepSeek Harness needs ChatGPT account access to pi-ai's `openai-codex` models without requiring users to patch the Harness agent or accept a fork of the main repository. OAuth state, token refresh, model streaming, Web presentation, and uninstall behavior must have one owner.

## Decision

The standalone composition bundle owns the Cordis Host plugin, Web Client settings section, Browser and Device Code authorization controller, owner-only credential store, direct pi-ai-backed `LlmAdapter`, headless login command, tests, and release cadence. It uses only public exports from the exact DeepSeek Harness `0.1.0-rc.6` package set, Cordis `4.0.1`, and pi-ai `0.82.1`; the Harness repository contains no plugin-specific runtime code.

Cordis, React, pi-ai, and DSH packages are exact optional peers supplied by the compatible Harness host. The published plugin installs only its owned file-locking dependency and runs no installation lifecycle script. A package-contract test enforces this division, and CI installs the packed artifact into a clean published Harness host before booting and removing it.

Each login attempt uses the user's explicit Browser or Device Code selection. Browser uses pi-ai's PKCE loopback callback; Device Code is the supported alternative for headless and callback-constrained environments. The plugin starts no Codex App Server and creates no provider-owned conversation, so Harness continues to own its agent loop and durable session history.

The credential file belongs to the plugin under `$DSH_HOME/plugins/dsh-openai-oauth`. Uninstall preserves that file unless the user logs out first. The Web route is local-only and exposes redacted status and public authorization instructions, never credentials.

## Alternatives considered

**Keep the implementation inside DeepSeek Harness.** This would make every user modify or wait for a Harness release and would couple the OAuth release cadence to the core repository.

**Use Codex App Server as the LLM adapter.** This would start a nested coding-agent turn, add a child process and provider thread state, and bypass the Harness-owned agent loop rather than only supplying model access.

**Reuse a process-wide credential file or `~/.codex/auth.json`.** Shared ownership would make logout and refresh races ambiguous and could modify credentials used by another application.

**Expose a general OAuth extension in Harness first.** Version `0.1.0-rc.6` already provides the public plugin, LLM adapter, Web route, and Client slot APIs needed by a self-contained bundle; a provider-neutral OAuth service would add a core abstraction before another provider needs it.

## Consequences

Users install one ordinary DSH bundle and do not change their agent or Harness packages. The installer changes only the selected profile's normal package and composition state. OAuth updates can ship independently, and either login method reaches the same credential and adapter lifecycle. Exact version pins and a local-only Web posture deliberately narrow compatibility; a later Harness, remote UI, or upstream OpenAI protocol change requires a reviewed plugin release rather than an implicit fallback.
