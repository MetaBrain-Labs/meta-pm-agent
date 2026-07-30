---
name: deliver-prd
description: Create a graph-grounded Product Requirements Document that aligns product, design, engineering, QA, and business on why to build, which problem to solve, what functionality is required, and how complete the solution must be.
license: Apache-2.0
---
<!--
Adapted from product-on-purpose/pm-skills skills/deliver-prd, version 2.1.0.
Source: https://github.com/product-on-purpose/pm-skills
-->

# Deliver a Product Requirements Document

Build one coherent PRD from the supplied product knowledge graph.

## Required Structure

1. Title and version context
2. Background and problem statement
3. Goals and non-goals
4. Target users and scenarios
5. Functional requirements
6. User stories and acceptance criteria
7. Product scope and priority
8. Data, metrics, and success signals
9. Dependencies, constraints, and risks
10. API, integration, or interface notes when evidence supports them
11. Open questions and evidence gaps
12. Release and validation checklist

## Drafting Rules

- Explain why the work matters before describing the solution.
- Connect every feature to a problem, goal, or requirement.
- Give each functional requirement a stable ID, source node IDs, priority or
  `TBD`, expected behavior, and completion signal.
- Separate in-scope, out-of-scope, and deferred work.
- Use measurable success criteria only when the graph supplies a baseline,
  target, or confirmed measurement method.
- Surface technical considerations without inventing implementation design.
- Keep the main document readable by non-technical stakeholders while making
  critical requirements unambiguous for design, engineering, and QA.

## Acceptance Depth

- Expand P0, critical-path, and high-risk requirements into testable user
  stories, Given/When/Then acceptance criteria, important failures, recovery,
  and relevant non-functional expectations.
- Keep P1 and P2 requirements concise unless graph evidence marks them as high
  risk.
- If priority is not supported by evidence, write `TBD` instead of assigning
  one.

## Final Check

Confirm that a reader can answer:

1. Why are we building this?
2. What problem are we solving, and for whom?
3. What must the product do?
4. What scope and observable outcomes define done?
