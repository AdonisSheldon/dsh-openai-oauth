# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled for the repository. If it is unavailable, open a public issue asking the maintainer to establish a private channel, without vulnerability details. Never post access tokens, refresh tokens, authorization codes, credential files, raw OAuth responses, or unredacted logs in a public issue.

Include the plugin version, DeepSeek Harness version, operating system, affected login method, impact, and a reproduction with every secret replaced. The maintainer will acknowledge the report and provide coordination details through the private channel.

## Supported security posture

Version `0.1.0` supports only a local Web Host bound to `127.0.0.1` and a local headless CLI. Remote, proxied, container-forwarded, and Electron transports are outside the supported security posture.

The credential file is plaintext protected by owner-only filesystem access, not encrypted storage. The Web route returns no credential value, accepts requests only from loopback with a local Host header, and requires same-origin browser metadata for mutations. These controls do not protect an already-compromised operating-system account or process with access to the Harness home.
