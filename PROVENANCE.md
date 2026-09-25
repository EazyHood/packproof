# Work provenance

Started during the IBM Bob 2.0 build window, 25 September 2026 (Colombia time).

| Component | Actual contributor / method | State |
|---|---|---|
| Planning brief and acceptance criteria | Codex, based on official event materials and prior planning | Written |
| Independent fixture packages and consumer reference contracts | Codex, separately attributed under validation-fixtures | Written; 5 source tests passed and 6 manual consumer cases observed as expected |
| PackProof CLI, archive/report pipeline and substantive implementation | IBM Bob IDE (tasks BOB_TASK_01, BOB_TASK_02, BOB_TASK_03) | Implemented, repaired and hardened: all src/ and test/ files; verify.mjs new in task 03; README.md new in task 03 |
| Independent verification and review | Codex | Original task 03: 48/49 tests passed; both false-PASS controls corrected and six demo outcomes matched. Final review corrections: 64/64 tests passed, 0 skipped, six demo outcomes matched and source baseline passed on Windows. |
| Final evidence corrections | Codex, separately attributed after preserving Bob task 03 | Real bounded archive-byte comparison, exact installed identity, pre/post evidence gating, corrected regression fixture, command records, strict missing-baseline handling and documentation; original Bob code retained in d246d37 |
| Bob consumption-summary screenshots | Actual Bob IDE task output required | Tasks 01–03 produced code; genuine final consumption-summary screenshots not yet collected |
| Report viewer and export script | Codex | Static saved-report viewer completed; six authentic redacted reports, import/filter/details controls and responsive layout verified in isolated headless Chromium; no MP4 or public submission yet |
| Demo storyboard and independent comparator evaluation | Codex | Storyboard drafted; publint/ATTW comparison recorded separately, not PackProof runner results |

## Implementation notes (Bob task BOB_TASK_01)

Files created by IBM Bob IDE in this task:

- `package.json` — project manifest, `packproof` bin entry, test script
- `src/hash.mjs` — SHA-256 of files and strings (Node crypto built-in)
- `src/pack.mjs` — wraps `npm pack --ignore-scripts --json`; records tarball path, SHA-256 and packed file list
- `src/install.mjs` — installs a tarball into an isolated consumer directory with `--offline --ignore-scripts`; uses a per-run npm cache
- `src/run-contract.mjs` — runs `node ./contract.mjs` in the consumer directory with a configurable kill timeout; captures stdout, stderr, exit and timedOut flag
- `src/classify.mjs` — maps (packExit, installExit, contractExit, timedOut, spawnError) → PASS / FAIL / INCONCLUSIVE; timeout is never PASS
- `src/report.mjs` — builds and writes a versioned JSON report (`packproof-report-v1`); hashes the contract source; no fabricated values
- `src/runner.mjs` — orchestrates the full pipeline; each runCase call is independent
- `src/cli.mjs` — CLI with `--fixture/--contract/--out/--timeout/--case/--demo/--help`; `--demo` runs all six fixture cases
- `test/packproof.test.mjs` — node:test suite covering hash, classify, report build, runContract (timeout, exit capture), source contract correctness, and CLI argument validation

Frozen consumer contracts under `validation-fixtures/contracts/` were not modified. The Codex manual baseline observations.json was not modified.

No claims of real customer adoption, measured productivity gains, novelty over all existing tools, or contest submission are made at this stage. No paid plan or purchase has been activated.

## Repair summary — Bob task BOB_TASK_02

Files changed by IBM Bob IDE in this task:

- **`src/npm-runner.mjs`** (new) — portable npm discovery via NPM_EXECPATH, node-adjacent npm-cli.js, and POSIX lib/node_modules; never spawns npm.cmd with shell:false; finite timeout for all npm invocations; actionable error when npm-cli.js not found
- **`src/pack.mjs`** — uses `spawnNpm()`; finite timeout; strict JSON parse with no directory fallback; records `packageName`, `packSignal`, `packTimedOut`, `packError`, `npmCliJs`
- **`src/install.mjs`** — uses `spawnNpm()`; consumer allocated via `mkdtempSync` in OS `tmpdir()` (outside checkout); hashes copied contract bytes **before** execution; null on hash failure (not empty-string hash); records `contractCopiedSHA256`, `installedPkgName`, `isolationPreconditionMet`, install signal/timeout/error fields; resolves installed package by reading `package.json` from node_modules, verifying path stays inside consumerDir
- **`src/run-contract.mjs`** — definitive timeout detection via `result.error?.code === 'ETIMEDOUT'` only; raw stdout/stderr preserved (no `trimEnd()`); signal field always set
- **`src/classify.mjs`** — timeout checked **before** spawn-error; null contractExit without timedOut/error → INCONCLUSIVE (rule 6); external signal → INCONCLUSIVE; packExit null → INCONCLUSIVE; all eight precedence rules documented
- **`src/runner.mjs`** — run directory named by UUID (not caseName); collision check; archive dir inside runDir; npm cache in OS tmpdir; `contractCopiedSHA256` from installResult (pre-execution); `contractSignal` passed to classify; report filename is `report.json` (fixed); returns `runDir` in result
- **`src/report.mjs`** — removed file-read of contract (SHA-256 now pre-computed); records `contractCopiedPath`, `contractCopiedSHA256` (null when install skipped); all new fields from pack/install/contract; no dependency on `hash.mjs`
- **`src/cli.mjs`** — `parseTimeout()` rejects non-digit characters (e.g. `12oops`); demo passes `timeoutMs` from CLI; `mkdirSync` for demo baseOutDir; `artifactDir` parameter; error-caught `runCase` call; shows `RunDir` in output
- **`test/packproof.test.mjs`** — 40 tests across §1–§10; §10 adds six E2E tests with real npm pack/install (skipped when npm-cli.js unavailable); §9 adds path traversal, repeat run, report-filename regressions; §5 adds null-exit and timeout-reason regressions; §7 adds malformed timeout and zero timeout tests; §8 adds npm-runner unit tests

## Historical independent review after task 01

Codex preserved the original Bob implementation in local commit `3ab678e` before preparing any corrections. The 23 passing tests do not exercise the full pack/install/runCase pipeline. All six demo cases actually returned INCONCLUSIVE because Windows rejected a direct npm.cmd spawn with shell:false (EINVAL). Codex also reproduced report overwrite, case-label path traversal within a disposable probe directory and misleading timeout wording. These were the limitations before tasks 02–03 and final review corrections.

Historical state before task 02: BOB_REVIEW_01.md and BOB_TASK_02.md were written by Codex for Jhona to send manually. Task 02 has since produced the changes described above and is preserved in commit `51b4837`. Codex observed 42 passing tests and six matching demo outcomes, then reproduced two false PASS evidence controls described in BOB_REVIEW_02.md. BOB_TASK_03.md was then prepared by Codex and executed by IBM Bob IDE, producing the task 03 changes described below. No core source, test or frozen contract was changed by Codex during these reviews. No final task consumption figure or session screenshot has been observed. Work proceeds through files and commands without controlling the user's windows.

## Task 03 work — Bob task BOB_TASK_03

Files created or changed by IBM Bob IDE in this task:

- **`src/verify.mjs`** (new) — explicit verification of isolation (consumer realpath outside fixtureDir, no ancestor node_modules, not a symlink), identity (installed package name matches npm pack metadata), contractHash (bytes before vs after execution), and installedBytes (package.json presence). Required checks (isolation, identity, contractHash) produce INCONCLUSIVE on failure.
- **`src/run-contract.mjs`** — `killSignal` changed to `'SIGKILL'`; `elapsedMs` field added to result.
- **`src/runner.mjs`** — calls `verifyRun()` after install; blocks contract execution when required prerequisites fail; post-execution contract re-hash; passes `prereqFailure` and `contractHashChanged` to classify; `runSourceBaseline` option; source baseline helper uses `spawnSync` + SHA-256 of script.
- **`src/classify.mjs`** — added rules 3 (prereqFailure) and 4 (contractHashChanged) before timeout and spawn-error rules; all 10 rules documented.
- **`src/report.mjs`** — added `verify`, `elapsedMs`, and `sourceBaseline` fields to the report schema.
- **`src/cli.mjs`** — demo runs source baseline for first case only; prints source baseline status in summary; single-case mode marks sourceBaseline as `not-run`.
- **`test/packproof.test.mjs`** — §9 uses `t.skip()` when npm unavailable; §10 E2E tests use `t.skip()` via `runE2E` helper; §11 adds verify unit tests (isolation, identity, contractHash, installedBytes) and false-PASS regressions for classify (prereqFailure, contractHashChanged); §12 adds ancestor node_modules detection test.
- **`README.md`** (new) — installation prerequisites, test/demo/single-case commands, PASS/FAIL/INCONCLUSIVE explanation, output paths, inspectable temporary data, trusted-fixture-only scope, verification checks, platform limitations, and validation commands.

Frozen consumer contracts under `validation-fixtures/contracts/` were not modified.
Frozen fixture packages and evidence under `validation-fixtures/` were not modified.
No claims of executed task 03 tests or captured consumption screenshots are made at this stage.

## Final independent verification and corrections — Codex

Bob task 03 was preserved unmodified in commit `d246d37` before review edits. Its suite had 48 passes and one failure: the ancestor-resolution test did not create its source fixture. The six demo cases and actual source baseline passed; both independently reproduced false-PASS controls now returned INCONCLUSIVE.

Codex corrected the test setup, completed bounded in-memory tarball-to-installed-file comparison, exact package-path/identity verification, mandatory positive pre/post checks, error/signal classification, source-baseline completeness, command records and documentation. New files `src/archive-integrity.mjs`, `test/evidence-integrity.test.mjs` and `test/review-regressions.test.mjs` are Codex work. These changes build on Bob's substantive CLI and report pipeline and are not attributed to Bob.

Final observed validation on Windows, Node 24.16.0/npm 11.13.0: **64 tests passed, 0 failed, 0 skipped**; **six demo observations matched**, with three genuine contract failures retained as FAIL; the frozen source baseline passed. Additional actual executions cover changed contract bytes, an unreadable contract copy and changed installed package bytes. Linux has not been tested. Raw records are retained outside the public project under the coordinating task's `outputs/ibm-bob-2/validation-final-2026-09-25` directory.

Frozen fixture packages and reference contracts remain unchanged. No customer adoption, measured time savings, prize, public submission or genuine consumption-summary screenshot is implied by these results. Bob's final consumption for each task remains unrecorded until real screenshots are supplied.

## Static viewer — Codex

The presentation viewer and export script are separate Codex work. The bundled six reports came from the final verified core commit `8bb3538`; original records are retained separately and personal host paths are redacted in the shared copy. Independent headless Chromium checks passed for loading the saved reports, PASS/FAIL filtering, search recovery, case selection, malformed import recovery, hostile HTML treated as text, keyboard focus and widths of 375/768/1440 pixels. No JavaScript exception or external network request was observed. Desktop and mobile screenshots were visually reviewed. These checks do not execute packages in the browser or authenticate a report's author.
