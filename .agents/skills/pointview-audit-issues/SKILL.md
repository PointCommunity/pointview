---
name: pointview-audit-issues
description: "Audit and correct prioritization and metadata for PointView Backlog Issues only. Use when the PM asks to audit, reprioritize, clean up, or validate the backlog."
---

# Audit the PointView Backlog

Read `AGENTS.md`, `.agents/pointview-pipeline-policy.html`, the live Project fields, every Backlog Issue, and relevant duplicate or dependency evidence.

- Scope is strictly Status `Backlog`. Do not edit On Hold, In Progress, In Review, or Done cards.
- Verify every Backlog Issue is open, unassigned, has exactly one governed type label, at least one area label, and populated Priority, Impact, and Effort.
- Reassess ordering by security/functionality criticality first, then Impact relative to Effort. P0 is reserved for urgent security, privacy, data-integrity, or application-blocking work.
- When invoked, apply justified Backlog-only metadata corrections without a second approval. Preserve Issue scope, body, Status, assignment, milestone, dependencies, and pipeline state.
- Never create labels, Project fields, statuses, Issues, branches, or PRs during an audit.
- Read every mutation back and report the before/after value and concise rationale. Report no-op audits explicitly.
