# Security Policy

## Supported Versions

Only the latest release is supported with security updates.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use [GitHub Private Vulnerability Reporting](https://github.com/stevencrawford/sess/security/advisories/new) to submit a report.

You should receive a response within 7 days. If the vulnerability is confirmed, a fix will be released as soon as possible.

## Scope

Reports related to the following are in scope:

- Unauthorized file access or path traversal
- Cross-site scripting (XSS) via rendered Markdown
- Authentication or authorization bypass on the local server
- Remote code execution

The `--dangerously-allow-remote-access` flag intentionally disables access restrictions. Vulnerabilities that require this flag to be enabled are generally out of scope, as the flag name itself signals the associated risk.
