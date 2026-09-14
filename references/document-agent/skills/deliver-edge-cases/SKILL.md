---
name: deliver-edge-cases
description: Identify graph-supported boundary conditions, error states, concurrency risks, dependency failures, and recovery paths for P0, critical-path, or high-risk PRD requirements.
license: Apache-2.0
---
<!--
Adapted from product-on-purpose/pm-skills skills/deliver-edge-cases,
version 2.1.1. Source: https://github.com/product-on-purpose/pm-skills
-->

# Deliver Edge Cases

Use this skill to make critical requirements safe and testable without
expanding every lower-priority feature.

## Workflow

1. Name the requirement ID and source node IDs being analyzed.
2. Check empty, invalid, minimum, maximum, duplicate, stale, and conflicting
   inputs when those states apply.
3. Check permission denial, unavailable dependencies, timeouts, partial
   completion, concurrent changes, retries, and repeated actions when supported
   by the described flow.
4. For every included failure, specify the observable behavior, user-facing
   recovery, and whether data or progress is preserved.
5. Prioritize only from graph evidence. Otherwise mark likelihood or impact as
   `TBD`.

Do not manufacture APIs, limits, messages, roles, or system behavior merely to
fill a catalog.

<!-- Third-party attribution: adapted from product-on-purpose/pm-skills; Apache-2.0. Local changes bind guidance to this application. Original import revision was not recorded. See /THIRD_PARTY_NOTICES.md for license texts. -->
