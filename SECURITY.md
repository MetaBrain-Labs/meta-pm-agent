# Security

## Supported deployment

Only the latest preview is maintained. This release is for one user on a trusted local computer. It has a fixed local account, no multi-user authentication or tenant isolation. Keep PostgreSQL and Redis private. The API accepts loopback HOST values only and rejects browser origins outside CORS_ORIGINS. These controls do not protect against malicious local software.

Model providers receive conversations and relevant product context. Search providers receive search queries. When LANGSMITH_TRACING is enabled, LangSmith may receive prompts, responses and execution traces. Debug summaries and crash reports can contain product information. Use synthetic data for reports and demos. The current frontend also loads Google Fonts, which contacts Google font servers even during local use; it does not send product prompts through that font request.

## Reporting a vulnerability

Do not report vulnerabilities or credentials in public issues. Use GitHub's private reporting form at https://github.com/MetaBrain-Labs/meta-pm-agent/security/advisories/new **after maintainers enable private vulnerability reporting**. Until that channel is enabled, do not submit sensitive details publicly. Maintainers must enable and verify this channel before the first public release; see RELEASE_CHECKLIST.md.

Include affected revision, impact and a minimal synthetic reproduction. Never include real credentials or customer data. If you expose a credential, revoke or rotate it immediately.

Private reporting availability has not been verified from this workspace. No response-time commitment is made for this preview.
