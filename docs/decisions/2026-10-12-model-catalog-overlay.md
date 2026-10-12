# User-editable model catalog for the OpenAI Codex provider

Status: accepted

## Context

The provider shipped a fixed, versioned model catalog (`src/models.ts`) plus a
settings section that only owned OAuth sign-in. Two requests arrived: add
`gpt-6.1-sol` to the catalog, and let a user add and edit models — including
each model's context window and maximum output tokens — from the settings UI.

The Harness it plugs into already renders a Models settings page
(`@deepseek-ai/dsh-client-ui-settings-models`) that edits a provider's model
list, so the first question was whether this plugin should participate in that
page instead of drawing its own editor.

## Decision

The plugin owns the editor: a persisted catalog overlay under
`$DSH_HOME/plugins/dsh-openai-oauth/models.json`, three endpoints on the
plugin's existing local route, and a model block inside the plugin's own
settings section.

- An overlay entry keyed by a built-in id overrides that model's
  `contextWindow`/`maxTokens`; every other field stays built-in. An overlay
  entry with a new id is a custom model with a name, a context window, and a
  maximum output, and inherits the built-in reasoning level map and
  text+image input.
- The route keeps every property of the OAuth route (loopback-only, same-origin
  POST, JSON-only, exact-key bodies, 4096-byte cap, `{error:{code,message}}`).
- Resolution stays synchronous and pure (`resolveCatalog`), so `listModels`
  keeps its current shape and needs no cache.
- A model's maximum output reaches the wire: `resolveModel` reports
  `defaultMaxTokens`, the adapter accepts `options.maxTokens`, and the
  Responses request carries `max_output_tokens`.
- After every successful mutation the plugin re-declares its own adapter route
  through the registration handle returned by `registerAdapter`, which
  publishes `llm/adapters-updated`, so a client model catalog refreshes
  without a DSH restart.

## Alternatives considered

**Reuse the core Models page via `registerConfigurableProviders` plus a
settings namespace.** Rejected: the core page dispatches its editor by
namespace id only. `layoutOf(ns)` maps `llm-deepseek` and `llm-pi-ai` and
falls through to `unknown` for every other namespace, which renders a
one-line hint and no catalog editor at all
(`dsh-client-ui-settings-models/lib/client.js:1518-1523`, `:1839-1842`).
Declaring the route in both registries would have been legal — the adapter map
and the directory map are separate (`dsh-llm/lib/index.js:1797-1798`,
`:1857`, `:1918-1920`) — but the editor would never appear.

**Store the overlay in the profile settings document (`cordis.patch.yml`).**
Rejected for the same reason, plus the plugin already owns a state directory
with owner-only permissions and atomic writes; reusing it keeps credential and
catalog state under one reviewed storage pattern.

**Treat the maximum output as display-only metadata.** Rejected by the user:
the field is expected to constrain generation, so it is materialized as
`defaultMaxTokens` and sent as `max_output_tokens`.

## Consequences

Built-in models stay in the shipped catalog and the overlay can only narrow or
widen what the provider already declares, so a Harness or plugin release can
add models without touching stored user state. `ctx.llm.listModels` is
uncached, so a saved model appears to the Harness on the next catalog read.

The wire field was verified against the live endpoint before release, not
assumed from documentation: a `gpt-6.1-sol` Responses request carrying
`max_output_tokens: 64` answered `HTTP 200` with a `response.completed`
terminal event, exactly like the same request without the field. The value is
therefore sent as declared and no metadata-only fallback is needed.
