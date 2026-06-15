# Artifact Types

Status: Draft (2026-06-15)

This document defines what belongs in each memory-bank artifact type so durable knowledge does not drift into the wrong place.

Related documents:

- [Memory Bank principles](principles.md): Governing rules for single source of truth, one concept per file, and WHAT/WHY/HOW separation. Read this before choosing an artifact type.
- [Writing format](format.md): Markdown shape, naming rules, and split guidance. Read this while authoring a document.
- [Authoring workflows](workflows.md): Practical workflows for adding requirements, ADRs, plans, seeds, and scenarios. Read this for step-by-step maintenance.

## Specs

Specs answer `what must the system do?`

Use specs for:

- user-facing behavior,
- business rules,
- durable UI contracts,
- data meaning and invariants,
- externally observable error or export behavior,
- acceptance-relevant geometry or interaction rules.

Do not use specs for:

- component names,
- function inventories,
- source file maps,
- library calls,
- temporary refactor notes,
- implementation strategies that can change without changing behavior.

## ADRs

ADRs answer `why did we choose this?`

Use ADRs for stable decisions with meaningful tradeoffs, such as architecture boundaries, policy choices, persistence contracts, export semantics, or intentionally omitted behavior.

Do not use ADRs for routine implementation notes or decisions that are obvious from current code and carry no durable tradeoff.

## Plans

Plans answer `how will we deliver and verify this?`

Use plans for epics, feature slices, sequencing, risks, acceptance criteria, and verification expectations.

Plans should point back to specs and ADRs. Once behavior is implemented, the durable rule belongs in specs or ADRs, not only in the plan.

## Testing Docs

Testing docs answer `how is this behavior proven deterministically?`

Use scenario docs for end-to-end flows with setup, action, and assertions. Use seed docs for reusable deterministic starting states.

Testing docs should reference the specs they prove instead of redefining requirements in parallel.

## Repository Structure Docs

Repository structure docs answer `where does this kind of thing belong?`

Use structure docs for high-level folder responsibilities and boundaries. Keep detailed implementation maps in code or generated documentation unless they define a stable project rule.

## Code

Code is the source of truth for concrete implementation.

Keep these out of the memory bank unless they are part of a stable public contract:

- exact module paths,
- exact function names,
- internal helper responsibilities,
- component composition details,
- framework-specific lifecycle mechanics,
- generated-file details.

## Split Rule

When one spec starts mixing multiple user workflows, split it by stable product concept:

- surface overview,
- mode,
- tool,
- cross-cutting contract,
- domain rule.

The overview should link to the focused specs instead of carrying all details itself.
