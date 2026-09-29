# CLAUDE.md: Autonomous Build Loop Rules

You are building the solo D&D browser game specified in `solo-dnd-build-prompt.md` (the "Build Prompt").
You run inside an **automated loop**: every session is a fresh start with an empty context, and you complete **exactly one assignment** per session. Your only memory between sessions is `brain.md`. Treat it as your brain: if it isn't written there, you won't know it next time.

These rules **override** anything in the Build Prompt that conflicts with them.

---

## 1. Overrides to the Build Prompt

- **Never ask questions and never wait for approval.** Nobody is watching the session. Where the Build Prompt says "ask me," "wait for approval," or "propose ... and wait," instead **choose the most sensible option, proceed, and log the decision** in `brain.md` → Decisions Log (what you chose, the alternatives, and why).
- **`brain.md` replaces `PROGRESS.md`.** Don't create or maintain `PROGRESS.md`.
- The Build Prompt's "one question at a time" rule applies only to the owner reviewing `brain.md` later, not to you during a session.

## 2. Agents: Maximum Two at a Time

- **At most 2 agents may work at once: you (the main coder) plus 1 helper subagent.** Never start a second helper while one is running, and helpers must not start agents of their own.
- A helper must run in its own git worktree (`isolation: "worktree"`) and work on a **separate assignment** that shares no files with yours (e.g. data/content items such as hand-written spell effects or world lore while you do engine code). Mark its assignment `in-progress (helper)` in `brain.md`.
- The helper does not edit `brain.md` or `loop_status.txt`. It commits on its worktree branch and reports back; you merge its branch, run the full tests, update `brain.md` for both assignments, and commit.
- If the helper's work fails its tests or conflicts, don't merge it: mark its assignment `failed` with notes (see §6).
- Don't launch other `claude` processes from the shell.
- If a task feels too big for one session, it's too big for one assignment: split it in `brain.md` (see §5), do the first part, and stop.

## 3. Session Protocol (follow it in order, every session)

1. **Load memory.** Read `brain.md` completely. Do not read the whole Build Prompt every session: read only the sections listed in the current assignment's `Spec refs`.
2. **Check for a stop signal.** If `brain.md` → Status says `DONE`, write `DONE` to `loop_status.txt` and end the session.
3. **Pick the assignment.** Take the first item in the Assignment Queue whose status is `todo`. Mark it `in-progress` in `brain.md` immediately.
4. **Orient cheaply.** Use the File Map in `brain.md` to open only the files you need. Don't scan the whole repo.
5. **Do the work.** Write the code, content, or data for this assignment only. Don't drift into other assignments; note ideas in the queue instead.
6. **Verify.** Run the relevant tests and type checks (and the build, if the assignment touches the frontend). The assignment isn't done until they pass. See §6 for failures.
7. **Update `brain.md`** (see §4). This step is mandatory, even if the assignment failed.
8. **Commit.** Run `git add -A` and `git commit -m "A<id>: <short summary>"`. Commit locally only; never push.
9. **Write the loop status** to `loop_status.txt` (see §7), then end the session with a one-line summary.

## 4. How to Maintain `brain.md`

`brain.md` must let a fresh copy of you continue with zero other context. After every assignment:

- **Status:** Update the current phase, last completed assignment, and overall state.
- **Assignment Queue:** Mark the assignment `done` (or `blocked` or `failed`). Add any follow-up assignments you discovered, in the right place in the queue.
- **Completed Log:** Add one line: `A<id> — what was built — key files`.
- **Decisions Log:** Add every non-trivial choice you made (libraries, schemas, model choice, design tradeoffs).
- **File Map:** Add new important files and folders with a one-line purpose. Remove entries for deleted files.
- **Gotchas & Lessons:** Add anything that cost you time and would cost the next session time too (Windows path quirks, a flaky test, a library's API surprise).
- **Blockers / Owner Review:** Add anything only the owner can fix, plus non-urgent decisions the owner may want to revisit.

**Keep it compact.** Keep `brain.md` under about 400 lines. When it grows past that, compress the Completed Log into per-phase summaries and prune stale gotchas. Never delete the Decisions Log, File Map, or Blockers; summarize them if needed.

Write facts, not narrative. Use short bullet lines.

## 5. Assignment Sizing

- One assignment is a single coherent unit that can be **finished and tested in one session**, for example "Dice roller + advantage/disadvantage + unit tests," "Point-buy UI step in character creator," or "AoE cone template on the grid."
- Each queue item has: `id`, `title`, `status`, `Spec refs` (Build Prompt section numbers), `Done when` (concrete, testable criteria), and `Depends on`.
- If you find mid-session that an assignment is too large, finish a meaningful, tested slice, then split the remainder into new queue items.

## 6. Failure and Blocker Policy

- **Test failures:** Try up to 3 focused fix attempts. If the failure is still there, revert or disable the broken part so the project still builds, mark the assignment `failed` with notes in `brain.md` (what you tried, the suspected cause), add a new retry assignment later in the queue, and continue normally (`CONTINUE`).
- **Blocked** means you can't proceed without the owner, for example: a required program isn't installed (Node, Git, Ollama), a needed command is refused by permissions, a download is impossible, or the machine lacks resources. Log it under Blockers with the exact fix the owner should do.
  - If other `todo` assignments don't depend on the blocker, skip to them and use `CONTINUE`.
  - If **nothing** in the queue can proceed, use `BLOCKED`.
- **Permission refused:** Don't try to work around a refused command with a different command that does the same thing. Log it as a blocker.
- Never leave the repo in a non-building state at the end of a session.

## 7. Loop Status File

At the very end of every session, overwrite `loop_status.txt` in the project root with **exactly one word, no spaces or other text**:

- `CONTINUE`: this assignment is finished (done or failed-and-logged), and more work remains.
- `BLOCKED`: no remaining assignment can proceed without the owner.
- `DONE`: every assignment in the queue is done, and Build Phase 13 is complete. Also set Status to `DONE` in `brain.md`.

## 8. Safety Rules

- Work **only inside this project folder.** Never read, edit, or delete files outside it (except installing npm packages into the project and pulling Ollama models).
- Never run `git push`, publish packages, install global npm packages, change system settings, or touch credentials, `.env` files from outside the project, or SSH keys.
- Only download assets from reputable sources, and only with verified CC0 or compatible licenses. Record every asset in `CREDITS.md`.
- Don't delete large amounts of code. Prefer editing, and rely on git history.

## 9. Windows and Environment Notes

- The target is Windows 10/11 with 8 GB of RAM. Use cross-platform Node APIs (`path.join`) rather than hard-coded separators. Launchers are `.bat` files with CRLF line endings.
- Ollama runs as a local service on `http://localhost:11434`. Never assume a model is loaded; check first, and use the mock LLM for tests.
- Tests must not require Ollama or TTS to be running. Use mocks.

## 10. Code Quality Standards

- Use TypeScript with strict mode. Keep modules small and prefer data-driven rules (see the Build Prompt, §4).
- Every rules-engine or logic change gets unit tests.
- Keep the architecture ready for the Build Prompt's §16 future expansions. Don't build them.
- Leave short doc comments at module level. Update `ARCHITECTURE.md` when the structure changes.
