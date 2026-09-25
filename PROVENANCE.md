# Work provenance

Started during the IBM Bob 2.0 build window, 25 September 2026 (Colombia time).

| Component | Actual contributor / method | State |
|---|---|---|
| Planning brief and acceptance criteria | Codex, based on official event materials and prior planning | Written |
| Independent fixture packages and consumer reference contracts | Codex, separately attributed under validation-fixtures | Written; 5 source tests passed and 6 manual consumer cases observed as expected |
| PackProof CLI, archive/report pipeline and substantive implementation | IBM Bob IDE (tasks BOB_TASK_01, BOB_TASK_02) | Implemented and repaired: `src/npm-runner.mjs` (new), plus all existing src/ and test/ files revised |
| Independent verification and review | Codex | Task 01: 23/23 unit tests pass, demo INCONCLUSIVE on Windows (npm.cmd EINVAL); Task 02 repairs applied by Bob; re-verification pending |
| Bob consumption-summary screenshots | Actual Bob IDE task output required | Task BOB_TASK_01 completed in this session; screenshot not yet collected |
| Report viewer and demo recording | Contributor will be recorded when produced | Not started |
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

## Independent review after task 01

Codex preserved the original Bob implementation in local commit `3ab678e` before preparing any corrections. The 23 passing tests do not exercise the full pack/install/runCase pipeline. All six demo cases actually returned INCONCLUSIVE because Windows rejected a direct npm.cmd spawn with shell:false (EINVAL). Codex also reproduced report overwrite, case-label path traversal within a disposable probe directory and misleading timeout wording. These are current limitations, not completed repairs.

BOB_REVIEW_01.md and BOB_TASK_02.md were written by Codex. Task 02 has been prepared for Jhona to send manually; it has not yet been sent or completed. No core source, test or frozen contract was changed by Codex during this review. No final task consumption figure or session screenshot has been observed. Work proceeds through files and commands without controlling the user's windows.
