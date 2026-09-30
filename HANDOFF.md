# Handoff — agent-team (Claude Agent SDK, 5-role agent team CLI)

Written for a fresh agent. Location: the user asked for this file to live in the project folder (`C:\work\my\agent-team`), so it is here (untracked; do not commit it unless the user asks). Talk to the user in **Thai**.

## State right now
- Repo `C:\work\my\agent-team`, branch **`feat/agent-team`**, HEAD `ea36c48`, 28 commits ahead of `main` (`ab375a5`, contains only the plan HTML). Working tree clean except two untracked files that are not part of the work: `agent_structure.txt` (the user's own original spec notes — never `git add` it) and this `HANDOFF.md`.
- All 16 plan tasks are implemented and reviewed, plus a final whole-branch review and a fix pass. `npm test` = 405 pass (20 files), `npm run typecheck` clean.
- **Pending user decision (was just asked, not answered):** how to finish the branch — 1) merge locally to `main`, 2) push + open PR, 3) keep as-is, 4) discard (needs typed `discard`). Nothing has been merged or pushed. There is no git remote configured (verify with `git remote -v` before offering a PR).
- **Not done:** the real end-to-end run against the real model (Task 16 steps 2-7). It needs an interactive session and spends the user's money, so it was deliberately left to the user. Auth pre-flight `npm run smoke:auth` passed once in Task 1 using existing credentials (no `ANTHROPIC_API_KEY` needed on this machine).

## Where things are (do not re-derive)
- Design + implementation plan (all 16 tasks, exact code, Global Constraints): `docs/plan/2026-09-19-agent-team.html`. Same content as markdown per task: `.tb/sdd/task-N-brief.md`.
- Progress ledger with every deferred Minor finding: `.tb/sdd/progress.md`. Per-task implementer reports: `.tb/sdd/task-N-report.md`. Final fix pass scope + report: `.tb/sdd/final-review-fixes.md`, `.tb/sdd/final-fix-report.md`. Guard review scope: `.tb/sdd/task-6-review-findings.md`. `.tb/` is on disk only (locally excluded through `.git/info/exclude`, never committed).
- User's usage docs: `README.md`. Config override file (optional, not created): `agent-team.config.json`. Team skills plugin root: `skills/` (skills go in `skills/skills/<name>/SKILL.md`, referenced as `team:<name>`).
- Code map: orchestrator state machine `src/orchestrator.ts`; phases `src/phases/{requirements,design,build,deliver}.ts`; SDK boundary `src/runner.ts` (only file calling `query()`), options `src/options.ts`, permissions `src/guard.ts` + `src/guard-bash.ts`, config `src/config.ts`, state `src/state.ts`, CLI `src/{cli,args,index}.ts`; test fakes `tests/helpers/`.
- Run: `npm start -- --project <existing dir> [--resume]`. `AGENT_TEAM_DEBUG=1` prints each role's init (skills/plugins/tools).

## Decisions the user made (keep honoring)
- Platform: Claude Agent SDK app in TypeScript; CLI in terminal; project folder passed at run time; QA = review + build/lint/test (no browser); permissions = autonomous inside the project with dangerous commands blocked (`dontAsk` + allowlist + guard hook); skills stored in this repo's `skills/` plugin and only via explicit per-role allowlist.
- Approach A: code-driven state machine (gates and the **5-round QA limit** are enforced in code, not prompts).
- Guard: user chose "fix fully" for the Bash guard holes (split into `guard.ts` + `guard-bash.ts`); the remaining known guard escapes are accepted as best-effort (it is not a sandbox).
- Final pass decisions: only `error_max_turns` / `error_max_budget_usd` count as a failed QA round (other errors still stop and `--resume`); the user's design-revision text is passed to Planning as `feedback` (`state.designFeedback`); read-only git (`status, diff, log, show, ls-files, rev-parse, blame`) is allowed.

## Known limits / risks for the first real run (from the final review; not saved elsewhere)
1. `Bash(node *)` / `Bash(python *)` are pre-approved and can do anything the OS user can (write outside project, touch `.git`); run only on a committed/backed-up project. `--project` loads that project's `.claude/settings.json` (its hooks/permissions); never point it at this repo. The whole shell environment is forwarded to agents.
2. Under `dontAsk`, `ls`, `cat`, `mkdir`, `cp`, compound `cd x && …` are denied — expect some turn churn; Claude Code's Bash tool on Windows needs Git Bash (`bash --version`); a cold `npm install` may exceed the default ~2 min Bash timeout.
3. Unverified against reality: whether `maxTurns` (PM 20/planning 40/workers 80) counts turns across resumed PM transcripts (PM could hit `error_max_turns` after ~20 exchanges); plugin/skills loading path (`plugins`, `skills`, `additionalDirectories`) has never run for real.
4. Cost shape: every QA round = full worker run + full QA run, up to 5 rounds per task. Start with a small project.

## Deferred "fix soon" items (optional next work)
`FileStateStore.load` validates only `version` (add a zod schema); `loadConfig` errors lack the file name; `saveArtifact` not atomic (tmp+rename like `save`); stale `design.json`/`reports/` remain after a fresh restart and `--resume` on DONE/ABORTED exits 0 silently, `ABORTED` also exits 0; `formatDesign` omits the `changed` flag; Planning prompt omits `overview`/task `title`; QA prompt test-path wording drifts from `TEST_PATH_PATTERNS`; the DELIVER "change" text does not reach Planning (unlike the REVIEW fix); `smoke-auth-lib` ignores `is_error` on a success result; README says git is "read-only" but `git diff --output=…` can still write a file; runner test gaps (budget/structured-retry subtypes, abort, `qa()`, debug log); SIGINT message in `src/index.ts` claims state is saved unconditionally. Full Minor list per task: `.tb/sdd/progress.md`.

## Conventions
- Commits: subagents wrote trailers with their own model name (`Claude Haiku 4.5` etc.); the harness asked for `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` on commits made by the main agent. Commit `3b7b5f3` has its trailer on the subject line (cosmetic; do not rewrite history unless asked).
- Never `git add -A`/`.`; stage explicit paths; keep `agent_structure.txt` out.
- Free-text `io.ask` in phases must use `askNonEmpty` (`src/io-util.ts`); persist state right after setting `state.pmSessionId` and before asking the user.

## Suggested skills
- `tb-finishing-a-development-branch` — resume here first: present the 4 options again and execute the user's choice (tests already verified green; re-run `npm test` before merging).
- `run` — if the user wants a real end-to-end run of the CLI on a small sample project (it costs money; confirm first).
- `tb-investigate-error` or `9arm-skills:debug-mantra` — if the first real run fails (read `<project>/.agent-team/state.json` and the role init lines from `AGENT_TEAM_DEBUG=1` first).
- `tb-brainstorming` then `tb-writing-plans` — if the user wants new features (e.g. `--help`, Planning feedback on DELIVER changes, parallel workers); `tb-subagent-driven-development` to execute a new plan (its scripts assume a task-brief format; the plan here is HTML, so briefs were generated from a markdown source — see `.tb/sdd/task-N-brief.md`).
- `tb-requesting-code-review` / `9arm-skills:scrutinize` — for an independent review of the branch before merging.
