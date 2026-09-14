---
name: deliver-acceptance-criteria
description: Turn a graph-supported P0, critical-path, or high-risk requirement into observable Given/When/Then acceptance criteria, including important failures, recovery behavior, and relevant non-functional expectations.
license: Apache-2.0
---
<!--
Adapted from product-on-purpose/pm-skills skills/deliver-acceptance-criteria,
version 1.1.0. Source: https://github.com/product-on-purpose/pm-skills
-->

# Deliver Acceptance Criteria

Use this skill only for requirements whose priority, criticality, or risk is
supported by the graph.

## Workflow

1. Bind the criteria to one requirement ID and its source node IDs.
2. State the supported user role, preconditions, and intended outcome.
3. Write the primary success flow first using Given/When/Then.
4. Add likely or costly validation failures and dependency failures.
5. Define user-visible recovery and whether entered data is preserved.
6. Add performance, accessibility, security, reliability, privacy, or
   auditability criteria only when relevant evidence exists.
7. Ensure each scenario has one observable pass/fail outcome and does not
   prescribe implementation.

If the requirement, priority, or expected behavior is unclear, record a `TBD`
or open question instead of inventing a criterion.

<!-- Third-party attribution: adapted from product-on-purpose/pm-skills; Apache-2.0. Local changes bind guidance to this application. Original import revision was not recorded. See /THIRD_PARTY_NOTICES.md for license texts. -->
