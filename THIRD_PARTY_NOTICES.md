# Third-party materials

Project-authored code and documentation are licensed under Apache-2.0. This does not replace third-party terms. License texts are distributed in `licenses/`.

| Material | Source and verification revision | License | Local treatment |
| --- | --- | --- | --- |
| Executor skills outside Interface Craft, also reused by Document Agent | [Pawel Huryn / pm-skills](https://github.com/phuryn/pm-skills/tree/18468a95b427e70e258b51389796367c6f684e7d) | MIT; Copyright (c) 2026 Pawel Huryn | Guidance adapted to graph execution; preserve MIT text in licenses/phuryn-LICENSE |
| deliver-prd, deliver-acceptance-criteria, deliver-edge-cases | [Jonathan Prisant / pm-skills](https://github.com/product-on-purpose/pm-skills/tree/1cef1a9eae10017389863d51e289e0ae41e17fcb) | Apache-2.0; Copyright 2026 Jonathan Prisant | Versions recorded locally: 2.1.0, 1.1.0, 2.1.1; interactive/filesystem behavior adapted |
| Interface Craft skills and anti-pattern guidance | [Impeccable](https://github.com/pbakaus/impeccable/tree/cb56ed6c19a07329a9fa0cd4e657bee040156593) | Apache-2.0; upstream attribution retained in licenses/pbakaus-LICENSE | Graph-specific adaptation of design guidance; architecture notes identify v3.7.1, original import commit not recorded |
| DeepSeek V3 tokenizer JSON and configuration | [DeepSeek-V3 model repository](https://huggingface.co/deepseek-ai/DeepSeek-V3) | Standalone tokenizer redistribution terms not established | Removed from this release; existing counter returns null and provider-reported usage is retained. No model weights are distributed |
| Previous raster icon and SVG wrappers | Original source not recorded | Not established | Removed from the current release tree |
| Current favicon.png, icon.png and icon generation material | Project-provided/generated asset; owner confirmed redistribution permission on 2026-09-14 | Apache-2.0 | Preserve concurrent user icon changes; ownership confirmation is separate from upstream skill verification |
| source-grounded-writing and deliver-visuals guidance | Project-authored application guidance | Apache-2.0 | Bound to the product knowledge graph and visual-block contract |

`licenses/skill-inventory.json` lists all 84 adapted skill files, their local SHA-256, upstream reference paths and verification revisions. Verification revisions identify the upstream source inspected during release preparation, **not** the original import commits. Each adapted file carries an English attribution/change notice. The original source lineage should be checked by maintainers before approving release, especially independently added guidance. The new favicon asset was separately confirmed by the project owner as project-owned and distributable under Apache-2.0.

The inspected upstream trees contain root LICENSE files and no root NOTICE file. Full upstream license texts and their embedded copyright/attribution statements are retained without rewriting them as project ownership.

Dependencies installed by pnpm retain their own licenses. Before distributing bundled binaries or a hosted frontend build, review the exact lockfile's dependency licenses and ship required notices for that distribution. No new third-party dependencies were introduced during this preparation.

Removing assets from the current source tree does not remove them from Git history or other branches. Review the history-release gate in RELEASE_CHECKLIST.md.
