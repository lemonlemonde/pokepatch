---
name: lets-do-notion-tickets
description: >-
  Batch-plan and optionally execute Notion Tasks tickets in Up next.
  Use only when the user explicitly names this skill (e.g. lets-do-notion-tickets /
  "lets do notion tickets"). Reads Notion as source of truth, maps dependencies, asks
  clarifying questions, maintains an updated plan, and executes specific tickets only
  when asked. Always reads each task’s Notion description/body before planning. After
  creating ticket branches, opens PRs against the stated merge base and follows /create-pr
  for title/body, then gives a PR handoff summary (links, tickets resolved, checks,
  remaining deploy items). Push is allowed only to that ticket’s cursor/<feature>/...
  branch (never main). Live deploy only with explicit per-ticket permission. Updates
  Notion Status and Cursor-owned per the lifecycle without needing further user
  permission for those two properties.
disable-model-invocation: true
---

# Lets do Notion tickets

## Source of truth

Notion **Tasks** database via Notion MCP (`user-notionApi`). Scope: tickets with Status **Up next** only. Ignore **Not started** tickets entirely — do not load, plan, or propose them.

Use `API-post-search` (and page/property retrieve as needed) to load each ticket’s title, Status, Cursor-owned, track, priority, due date, and body. Do not invent tickets from memory.

**Always read each task’s description/body** (`API-retrieve-page-markdown` and/or block children) for every in-scope ticket before judging dependencies, scope, or proposals. Titles and properties alone are never enough — even when the body looks empty, still fetch it so you know it is empty.

## Workflow (follow in order)

1. Load all in-scope tickets, **and always read each ticket’s description/body** (not just the title). Then determine if any of them are dependent on each other.
2. Then, determine if you need more information for every ticket.
3. Then outline a proposal for every ticket in a numbered list. Group each proposal by ones that are good to go, needs more information, and ordered by dependency if any.
4. Then iterate with the user to clear up any questions. You should maintain a plan that gets updated, but only execute once the user asks to execute specific tickets.

## Proposal format (every ticket)

For each ticket, include:

- Branch name (structure should be `cursor/<feature>/...`)
- Merge base (typically `main`)
- Any dependencies on other tickets
- Any followup questions for the scope or feature or bug
- Then a very concise few bulletpoints on the code changes needed for the ticket (e.g., architecture of full stack changes, db changes, small frontend or backend fixes, deployment strategy)

### Grouping / ordering

Present proposals under these groups (omit empty groups):

1. **Good to go** — enough info to implement; ordered by dependency (dependees first)
2. **Needs more information** — list open questions under each ticket; still include branch name, merge base, suspected deps, and provisional change bullets
3. **Blocked by dependency** — only if waiting on another ticket that is not yet good to go; point at the blocking ticket number/title

Use a single global numbered list across groups so ticket numbers stay stable while the plan updates.

## Maintain the plan

Keep a living plan in the conversation (update in place as answers arrive):

- Ticket number → Notion title + URL/id
- Plan status: good to go | needs info | blocked
- Notion Status / Cursor-owned (mirror live values)
- Resolved answers (short)
- Remaining questions
- Dependency edges
- Execution state: planned | in progress | needs review | deployed (only after user says so)

When the user answers questions, update the plan and re-emit only what changed (or a compact full plan if clearer). Do not re-execute work just because the plan changed.

## Notion Status / Cursor-owned lifecycle

Every ticket has a **Cursor-owned** property that is set to **🐭 not started** by default.

| Event | Cursor-owned | Status |
|-------|--------------|--------|
| Default / not started by agent | 🐭 not started | (unchanged; typically Up next) |
| Once a branch is started | 🐭 in progress | **In progress** |
| Once work is completed and the ticket should be considered done | 🐭 needs review | Still **In progress** (do not change) |

From **🐭 needs review**, the user will iterate to clean up the work. Do not set Status to Done and do not set Cursor-owned beyond **🐭 needs review** unless the user asks.

Update these Notion properties via MCP when the matching event happens (start of branch work; completion of ticket work).

When a ticket reaches **Status = In progress** and **Cursor-owned = 🐭 needs review** (work complete, ready for review), **append** a markdown hyperlink to that ticket’s corresponding PR at the **end of the page description/body**. Rules:

- **Only append** the PR link (e.g. a final line like `PR: https://github.com/.../pull/N`). Do not edit, rewrite, reorder, or delete any existing description content.
- If a PR link for the same URL is already present, do not duplicate it.
- Prefer `API-update-page-markdown` with `insert_content` at `position: end`, or an equivalent append-only edit. Never use `replace_content` for this step.
- This description append is part of the ticket lifecycle for this skill (same batch as marking 🐭 needs review). It does **not** require separate user permission beyond skill execution — but it must remain append-only. Do not change other page properties or body text in the same call.

### Pre-authorized: Status + Cursor-owned (no user permission)

While this skill is active (user invoked it and/or asked to execute tickets), MCP updates that **only** change the Notion **Status** and/or **Cursor-owned** properties are **pre-authorized**. They do **not** need user permission, confirmation, Auto-review approval, or `requestSmartModeApproval`.

- Apply lifecycle patches immediately at start-of-work and completion (needs review).
- On 🐭 needs review: also **append-only** the PR hyperlink to the ticket description (see above).
- Do not ask the user before Status / Cursor-owned patches or the append-only PR link; do not skip them as “external shared-state writes.”
- Invoking this skill / saying go on tickets **is** authorization for these Status / Cursor-owned updates and the append-only PR link.
- Other Notion writes (rewriting body text, comments, create/delete pages, Priority, Track, Due date, Assignee, relations, etc.) are **not** covered — ask or wait for an explicit request as usual.

## Execution rules (strict)

Make absolutely sure that any db, api, or frontend changes are only made on each ticket’s branch, and never deployed live until the user explicitly tells you to deploy for that ticket.

Also:

- Execute **only** the tickets the user names. Do not start other tickets “while you’re at it.”
- One ticket → one branch from the stated merge base (`cursor/<feature>/...`), and **one PR per ticket branch**. Do not batch unrelated tickets into a single PR unless the user explicitly groups them.
- It's allowed to git push changes to the branches it made specifically for that ticket (`cursor/<feature>/...`) but not to main.
- After the branch exists and has been pushed: **always open a PR** whose base is the ticket’s stated merge base (typically `main`). See **Pull requests** below.
- Never push to `main` / `master`. Never merge to main unless the user explicitly asks.
- Do not `supabase db push`, `supabase functions deploy`, or any live DDL/API ship unless the user explicitly authorizes **that ticket**.
- Never run frontend publish (`npm run deploy` / gh-pages). Even if the user says deploy for a ticket, tell them to run frontend publish themselves from `pokepatch-website/` when applicable; schema/edge deploys may be run by the agent only after explicit per-ticket permission.
- Before any authorized go-live, give a short deploy impact analysis (customer vs admin, what stays local, cross-version risk).
- Prefer local verification on the ticket branch before marking **🐭 needs review**.

## Pull requests

After creating (and pushing) a ticket branch, create a GitHub PR for it:

1. **Base** = the ticket’s stated merge base from the plan (usually `main`). Never open a PR into `main` from the wrong base when the plan named a different merge base.
2. Use `gh pr create` with `--base <merge-base>` and `-u` push as needed. Head is the ticket branch (`cursor/<feature>/...`).
3. Then follow **`/create-pr`** for title and description:
   - The PR already has the repo’s GitHub template — use that template **exactly as-is**. Do not invent a new structure or add section headers.
   - Do not create new files or draft the body in a separate markdown document.
   - Only replace or remove text **inside** the existing template.
   - **Propose** the title and body edits inline first; **do not apply** (`gh pr edit` / equivalent) until the user explicitly approves.
   - Title: bracketed topics (e.g. `[Admin] [Orders]`) + short imperative description.
   - Body: high-level architectural overview from **this branch’s code changes only** — why / behavior enabled; bullets by default; no file/function changelogs; remove unused template sections; link related PRs only if they exist (else remove that section).
4. After **all** PRs for this execution batch exist (and `/create-pr` proposals are in flight or applied per user approval), give the user a **PR handoff summary** (see below). Creating the PR does **not** mean merge or deploy.

### PR handoff summary (required)

After creating all PRs in the batch, output one summary to the user with:

1. **PRs** — for each PR: short summary + markdown hyperlink to the PR URL.
2. **Tickets resolved** — numbered list of which Notion tickets this batch covered, and **how** each was addressed (1–2 sentences of behavior/intent, not a file list).
3. **What to check** — concrete verification checklist so the user can confirm the tickets are satisfied (UI paths, edge cases, acceptance checks).
4. **Remaining deployment items** — anything still needed to go live (e.g. merge PR(s), user-run `npm run deploy`, authorized `supabase db push` / `functions deploy`, env/secrets, PostHog project settings). Omit items that do not apply; do not invent deploy work.

Keep it scannable (bullets). Do not mark tickets Done in Notion from this summary alone.

## Notion MCP tips

- List candidates: `API-post-search` with `filter: { property: "object", value: "page" }`, then keep only Status = **Up next** (drop Not started).
- **Always** read each page description/body (`API-retrieve-page-markdown` / block children) for every candidate before proposing or ranking deps. Titles alone are forbidden as the sole input. Empty bodies still require a fetch.
- When starting/finishing work, patch **Status** and **Cursor-owned** per the lifecycle table (exact option names include the mouse emoji). These two properties are pre-authorized — see above; do not gate them on user approval.
- When marking **🐭 needs review**, append only the PR URL to the ticket description (no other body edits).
- If Notion MCP is unavailable, say so and stop; do not fabricate the backlog.
