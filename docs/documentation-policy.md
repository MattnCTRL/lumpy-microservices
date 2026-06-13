# Documentation Policy

This repository keeps a hard separation between **tracked technical
documentation**, **untracked working notes**, and the **source code** itself.
The goal: the committed tree is always clean, professional, and free of
scratch commentary.

## Three layers

### 1. Source code — `apps/`, `packages/`

Code is kept sanitized at all times.

- No scratch comments, no "TODO: ask the AI", no narration of how a change was
  produced, no assistant attribution.
- Comments explain **why** something non-obvious is done, in the voice of the
  codebase — not a running commentary of the work.
- If a comment would only make sense to someone watching the code being
  written, it belongs in the working notes, not the code.

### 2. Technical documentation — `docs/` (tracked)

Durable, reader-facing documentation: architecture, APIs, configuration,
operations, security, and the roadmap. This is written for a future
maintainer (including you) and for the public, since the project is open
source.

Technical docs are part of "done": when behavior or an interface changes, the
relevant document is updated in the same change set.

### 3. Working notes — `.notes/` (untracked)

Everything that is process, reasoning trail, scratch design exploration, or
assistant-generated commentary lives in `.notes/`, which is git-ignored. It
never reaches the public repository.

Use it for: decision rationale captured while building, open questions,
exploratory designs, session logs, and any AI-assisted notation. Promote
anything that becomes durable and reader-facing into `docs/`.

## Rule of thumb

> If a reader of the public repository should see it, it goes in `docs/` or
> the code. If it is commentary about _building_ the project, it goes in
> `.notes/`.
