# Known limitations

- Single-user trusted local preview only. Fixed local account; no authentication or tenant isolation. API HOST and browser CORS origins are restricted to loopback.
- Model Usage Profiles currently enumerate DeepSeek model IDs, not arbitrary OpenAI-compatible models. Provider support and prices must be verified by the user; pricing is a configured estimate.
- PRD is the only enabled document kind. The document humanReview stage currently auto-approves; it does not wait for a person.
- Without durable PostgreSQL checkpoints, product workflows fall back to process-local memory and cannot recover across restart.
- The worker is a scaffold and requires Redis when started. The web/API can be started separately without the worker.
- Public-index search availability varies. Search failures are structured errors, not guaranteed evidence retrieval.
- Standalone tokenizer license was not established, so the bundled tokenizer assets were removed. The local correction function retains its existing null behavior; provider token usage may underreport reasoning when the provider omits it.
- Core tables use Prisma db:push for empty local setup; runtime tables use tracked additive SQL. This is not a complete versioned production migration system. Use the public schema. Back up existing databases before upgrades.
- Root Turbo lint/typecheck coverage is limited. Frontend ESLint may be blocked by Next's compiled parser availability. Builds and focused tests are the meaningful validation gates.

See RELEASE_NOTES.md for preparation results and RELEASE_CHECKLIST.md for remaining publication gates.
