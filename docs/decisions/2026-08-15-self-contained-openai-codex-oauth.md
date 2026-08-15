# Self-contained OpenAI Codex OAuth bundle

Status: accepted for implementation

The plugin owns OAuth, credential persistence, a direct pi-ai-backed `LlmAdapter`, a local Host route, a Client settings section, and a headless login command. DeepSeek Harness remains unmodified. Users explicitly select Browser login or Device Code login for each attempt. Browser login uses pi-ai's PKCE loopback callback; Device Code is the supported alternative when the callback cannot be reached.

The first release supports the complete published DeepSeek Harness `0.1.0-rc.6` package set, Cordis `4.0.1`, and pi-ai `0.82.1` exactly. It starts no Codex App Server and stores no second conversation. The source repository reported `0.1.0-rc.5` during planning, but npm did not publish a complete rc.5 Client dependency set; an immutable plugin cannot install against that incomplete release.
