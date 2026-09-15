# Synthetic local preview walkthrough

Audience: product managers and developers exploring a single-user AI product workspace. All names and requirements below are fictional. This is a manual acceptance scenario, not a claim that a real-model run already passed.

## Input

Add an existing local directory as **Synthetic Study Planner**, then create a conversation and select your configured model profile. Send:

> Design an MVP study planner for adult learners. A learner can create a study goal, schedule weekly sessions, mark sessions complete and view weekly progress. This is a personal-use web app with no social features or payments. Use only these requirements as evidence. The MVP should support one learner. Ask me to confirm important assumptions before adding requirements. Produce a clear product execution plan and a grounded PRD.

Answer clarification forms using only fictional data. If asked for a metric or source that is not supplied, choose an explicit assumption or leave it unknown; do not substitute a real customer document.

## Expected observable behavior

1. Conversation clarification appears before structured User Input and Request Analysis.
2. Orchestrator/Planner shows a DAG; each Executor owns its reasoning/tools/result cards.
3. After each completed Executor, the graph becomes available. Goal, session and progress concepts have traceable provenance; unsupported market claims are not presented as verified evidence.
4. Critique completes or exposes an actionable confirmation. Answer requested forms without starting an unrelated request.
5. On the Documents page, start the only exposed document type (PRD), observe drafting/scoring/automatic quality-review progress, open the artifact modal and download Markdown.
6. Rename the conversation and project, update the project to another readable absolute directory, and verify list labels/routes update. Delete the conversation, then remove the project and confirm the warning says local files are preserved.
7. Confirm no cloud, attachment, pin/archive, account identity, MRD/BRD, duplicate sidebar graph, or human-approval controls are rendered.

## Illustrative artifact excerpt

The following is an output shape example, **not model-generated acceptance evidence**:

```markdown
# Synthetic Study Planner — MVP PRD

## Goals
Enable one learner to plan and track weekly study sessions.

## Functional requirements
| Capability | Acceptance criterion | Source |
| --- | --- | --- |
| Study goals | A learner can create a named study goal | User requirement |
| Weekly sessions | A learner can schedule a session for a goal | User requirement |
| Completion | A learner can mark a scheduled session complete | User requirement |
| Weekly progress | Completed sessions are visible in a weekly summary | User requirement |

## Open questions
- Persistence and reminder behavior: TBD; confirm before expanding scope.
```

## Stop, restore and recovery checks

- During Executor execution, stop from the UI. Confirm the stop request reaches the server before the SSE fetch is aborted. Restore the conversation and confirm completed tasks remain visible.
- Continue the stopped request. Only failed/invalidated work and required dependents should rerun; completed unaffected results remain completed.
- Start PRD generation and navigate away. On returning to Documents, the background run should still be visible. Stop using its dedicated stop control and confirm status restoration.
- Generate a second PRD. Confirm the artifact can be previewed/downloaded with its version and full Markdown.

Record OS, Node, pnpm, PostgreSQL version, source revision, chosen provider/model IDs and actual outcomes in RELEASE_NOTES.md. Real-model verification incurs provider charges and is performed separately from PR CI.
