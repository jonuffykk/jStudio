# Security Policy

## Supported Versions

Only the latest published release is supported. Please update before reporting an issue.

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities. jStudio holds a Roblox session cookie, an Open Cloud API key and a model provider key in the OS keychain, runs a loopback HTTP bridge for the Studio plugin, launches MCP servers as child processes and replaces its own executable when it updates. Anything touching those paths belongs in a private report.

Report it through a [GitHub Security Advisory](https://github.com/jonuffykk/jStudio/security/advisories/new), or contact the maintainer directly through the links in the [README](../README.md).

Include: affected version, reproduction steps, and impact. Expect an initial response within a few days.

## Out of scope

- Prompt injection that only makes the model say something. The agent treats every tool result as untrusted data and every change to the place is a proposal the person approves, so a report needs to show injection actually reaching the place or the credentials.
- Findings that require an attacker to already have local access to the account running jStudio.
