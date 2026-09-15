# First public preview release checklist

Publish only after every blocking item is resolved. This file does not authorize commits, history rewrites or changing repository visibility.

## Source and permission gates

- [x] Add Apache-2.0 LICENSE and project NOTICE; update project license metadata.
- [x] Preserve full upstream skill licenses and inventory all adapted skill files.
- [x] Remove older SVG wrappers; preserve current generated PNG icons after owner confirmation; remove tokenizer assets without established standalone terms from the working release tree.
- [ ] Maintainers confirm original source lineage, copyright ownership and permission for all contributions and application-authored guidance. Upstream verification revisions are not original import revisions.
- [ ] Choose the exact branches/tags to publish; ensure excluded icons/tokenizer assets and private material cannot still be distributed from their reachable history. Current-tree removal alone is insufficient. Any history rewrite requires separate explicit approval.

## Security gates

- [x] Scan current publishable files and all locally reachable branch/tag histories with redacted output.
- [x] Review repeated localhost connection candidates as a documentation placeholder; allowlist only the exact fingerprint with a reason.
- [x] Replace current private path literals in langgraph.md and ignore local compile caches.
- [ ] Review historical private paths and compiled cache blob from the audit report; resolve their publication disposition without exposing private contents in issues.
- [ ] Confirm local remote-tracking refs match every intended remote ref; scan any missing remote-only history.
- [ ] Review GitHub Actions logs/artifacts, issues, PR attachments and real product/customer information. Authenticated GitHub access was not available in this workspace.
- [ ] Enable GitHub private vulnerability reporting and verify the SECURITY.md form works before publishing.
- [ ] Enable repository secret scanning/push protection where available and set appropriate branch protections.

## Reproducibility gates

- [x] Track runtime SQL, correct document FK creation order, provide db:init and repeatable db:upgrade.
- [x] Restrict local API binding and browser origins; document model/search/tracing data flow and costs.
- [x] Add CI with an isolated PostgreSQL 16 service, dummy model key, build/tests and redacted secret audit.
- [x] Verify focused runtime-table and message-type PostgreSQL integration tests against the isolated first-install test database; reproduce and fix varchar(20) failures without shortening identifiers.
- [ ] Obtain green normal CI, including fresh empty-database initialization and repeated upgrade. CI has not run remotely.
- [ ] Run the synthetic end-to-end scenario from a clean clone, including chat, graph, PRD download, stop and recovery; record actual outcomes.
- [ ] Capture and review actual synthetic screenshots. Local browser access was denied during preparation.

## Publication gates

- [x] Add contributing/security documents, issue and PR templates, synthetic walkthrough and known limitations.
- [ ] Update RELEASE_NOTES.md with actual CI/manual outcomes and final revision.
- [ ] After explicit user approval, commit reviewed source changes and create a preview tag and GitHub prerelease. Suggested tag: v0.1.0-preview.1; package versions are unchanged.
- [ ] After explicit user approval, make the chosen repository public and recheck release archive, installation links and private reporting.
