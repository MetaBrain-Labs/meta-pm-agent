---
name: source-grounded-writing
description: Ground document claims in the supplied product knowledge graph, preserve source-node traceability, and expose missing evidence without inventing facts. Use when drafting or reviewing any graph-derived product document.
---

# Source Grounded Writing

Treat the supplied product knowledge graph and section dossiers as the only
source of product facts.

## Workflow

1. Separate supported facts from assumptions, proposals, and missing details.
2. Cite relevant graph node IDs next to requirements, goals, metrics, risks,
   and decisions when traceability helps reviewers.
3. Preserve source status. Do not present proposed or deprecated nodes as
   confirmed facts.
4. Write unsupported required details as a specific `TBD`, evidence gap, or
   open question. Never invent metrics, baselines, targets, dates, owners,
   priorities, design links, integrations, or technical constraints.
5. Keep reasonable interpretation separate from evidence by labeling it
   `Assumption` and explaining what must be confirmed.
6. Before finalizing, verify that every material claim is either traceable to
   graph evidence or visibly marked as unresolved.

## Sparse Evidence

Still produce a useful draft when evidence is incomplete. Keep supported
content, mark missing fields with `TBD`, collect blocking gaps under Open
Questions, and state that the draft is not ready for approval.
