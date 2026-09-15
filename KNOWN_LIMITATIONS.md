# Known limitations

- Single-user trusted local preview only. There is no authentication, account profile, tenant isolation, team collaboration, or cloud deployment/sync. API HOST and browser CORS origins are restricted to loopback.
- Workspaces link to readable absolute directories on the API machine. Removing one is a recoverable database soft delete and never deletes local files, but v0.1 has no recycle-bin UI.
- Attachments are not supported. The v0.1 UI intentionally renders no attachment or cloud controls.
- Model Usage Profiles use the current `deepseek-flash` ID rather than arbitrary OpenAI-compatible models. Legacy v4 IDs are normalized. Built-in pricing is a dated estimate; provider billing remains authoritative.
- PRD is the only exposed document kind. The internal `humanReview` compatibility stage is an automatic quality pass and does not wait for a person; MRD/BRD and real human approval are not v0.1 capabilities.
- Without durable PostgreSQL checkpoints, product workflows fall back to process-local memory and cannot recover across restart.
- The Worker is an experimental scaffold with no v0.1 business producer. Root `pnpm dev` starts only Web/API and does not require Redis.
- Public-index search availability varies. Search failures are structured errors, not guaranteed evidence retrieval.
- Standalone tokenizer license was not established, so the bundled tokenizer assets were removed. The local correction function retains its existing null behavior; provider token usage may underreport reasoning when the provider omits it.
- Reasoning tokens share the model completion budget. Internal subagents that must return machine-parsed JSON (currently the Planner SubAgent) cap their own reasoning effort at `high` on the first attempt and `low` on the retry instead of using the profile setting verbatim; a run whose model exhausts the budget before emitting text reports `planner-output-starved` with the provider finish reason instead of a generic parse failure. Each full-mode orchestrator attempt also has a 5-minute wall-clock deadline.
- Core tables use Prisma db:push for empty local setup; runtime tables use tracked additive SQL. This is not a complete versioned production migration system. Use the public schema. Back up existing databases before upgrades.
- Root Turbo lint/typecheck coverage is limited. Frontend ESLint may be blocked by Next's compiled parser availability. Builds and focused tests are the meaningful validation gates.

See RELEASE_NOTES.md for preparation results and RELEASE_CHECKLIST.md for remaining publication gates.
