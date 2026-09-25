# Independent review of Bob task 01

Codex executed this review on 25 September 2026, Windows, Node v24.16.0, npm 11.13.0. Bob did not execute these commands. The original Bob implementation is preserved in local commit `3ab678e`; a byte-exact snapshot and raw logs are retained separately by Codex. No frozen fixture or contract was changed.

## Observed results

- `node --test --test-reporter=tap ./test/packproof.test.mjs`: **23 passed, 0 failed**. None of those tests exercises `runCase`, `packFixture` or `installTarball` end to end.
- `node ./src/cli.mjs --demo --out <new OS temp directory>`: **exit 1; all six cases INCONCLUSIVE** at the pack step. No installed contract was exercised by this demo.
- Independent direct subprocess probe: `spawnSync('npm.cmd', ['--version'], {shell:false})` yields `status:null`, `error.code: EINVAL`, empty stdout/stderr. The implementation loses this error and reports pack exit 1. Running `process.execPath` with the real `npm-cli.js` and `--version` gives exit 0 and `11.13.0\n` on this host. The discovered local candidate is adjacent to node.exe under `node_modules/npm/bin/npm-cli.js`; do not hardcode this host's absolute path as a portable solution.
- A controlled `runCase` with `caseName: '../../escaped-proof'` writes outside its requested run directory. The reproduction was deliberately contained in a new temporary parent folder; no user files were overwritten.
- Running twice with the same runDir/caseName generates different runIds but the same reportPath and **overwrites the earlier report**.
- A real 300 ms contract timeout is INCONCLUSIVE, but its reason incorrectly says the process failed to start. Timeout detection must take precedence over generic spawn-error wording.
- Classifier-only input with pack/install 0, contractExit null, timedOut false and no error returns FAIL. This is a synthetic unit probe, not a claim that a real signal termination was observed; an absent completion code needs INCONCLUSIVE.

## Additional findings from code review (not executed integrations)

- Existing consumer/archive directories are reused; no freshness or ancestor-resolution check. Selecting the first installed package is not verification of the intended package. Clearing NODE_PATH alone does not disable parent node_modules lookup.
- `packFixture` can fall back to an old `.tgz` when JSON metadata is invalid or the reported file is missing. Do not silently substitute another artifact.
- Contract hash is read from the original file after execution, rather than the executed copy. A failed read silently hashes an empty string. Raw stdout/stderr are trimmed.
- Pack/install have no timeout. SIGTERM alone is not a hard termination guarantee on systems where the child handles it; the tool is not a sandbox or a general process-tree containment tool.
- Source baseline, exact commands, elapsed time and signals are missing from the report. A report must distinguish missing checks from successful checks.
- `--timeout 12oops` passes parseInt validation; demo mode ignores the argument. A case label must never control a filesystem path.

## Frozen expected observations after repair

| Case | Contract outcome |
|---|---|
| missing-template-operation | FAIL (ENOENT) |
| missing-template-import-only | PASS; operationExercised false |
| fixed-operation | PASS; exact frozen label, including LF |
| fixed-wrong-expectation | FAIL (assertion) |
| broken-export-operation | FAIL (module cannot be imported) |
| tally-operation | PASS; totalUnits 11, lineCount 2 |

Demo exit 0 should mean all expected observations matched. It must not relabel expected failing contracts as PASS. Raw validation evidence is outside this workspace; everything needed to implement corrections is in this file. Do not access parent directories to find it.
