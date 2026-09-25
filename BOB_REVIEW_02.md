# Independent verification after Bob task 02

Codex, 25 September 2026. Windows, Node 24.16.0, npm 11.13.0. Bob task 02 source preserved unmodified in local commit `51b4837`. Frozen validation-fixtures are unchanged.

## Verified progress

- `node --test --test-reporter=tap ./test/packproof.test.mjs`: **42 passed, 0 failed, 0 skipped**. npm was available and real integration tests executed on this host.
- `node src/cli.mjs --demo --out <evidence directory>`: exit 0; **six of six observations matched**. Missing-template operation FAIL, import-only PASS, fixed operation PASS, deliberately wrong expectation FAIL, broken export FAIL, tally PASS. Expected failure remains FAIL, not a working package.
- npm Windows invocation, unique UUID artifact folders, fixed report.json names, raw output and timeout wording are improved.

## Two additional controls reproduced with actual executions

1. **False isolation precondition still permits PASS.** In a disposable copy of labels-fixed, Codex set TEMP/TMP for that probe process to a subdirectory of the copied source and ran the real contract. The report contains `consumer.isolationPreconditionMet: false` but `result.outcome: PASS`. The consumer actually resides inside that disposable source checkout. No original fixture was edited. Expected overall result: INCONCLUSIVE, with the isolation prerequisite explained.
2. **Changed executed contract still permits PASS.** A separate Codex control copies the original valid label operation, then appends a line that rewrites only its own disposable contract file after the operation succeeds. The runner records the before hash but does not rehash after execution. Observed PASS with different before/after bytes. Before SHA256: `661A44F641BC4B3599760E54DF558EF0605673BD572D7D1088FCCAEEEBF0A234`; after: `166C9CE13BC066A099BB0F6A54B54EA65BEF6E5AD51BB0A5096AA313A2849A42`. Expected overall result: INCONCLUSIVE, while retaining the actual contract exit 0 as evidence. Frozen contracts were not changed.

These are synthetic regression controls, not evidence of a security boundary or malicious customer activity. Raw reports and scripts are preserved by Codex outside this project; do not read parent directories.

## Remaining findings from reading the implementation

- `install.mjs` still scans for the first package. Its tarballPath argument is unused in package selection; the package name from packResult is not passed in. `resolve()` is lexical, not filesystem realpath. Ancestor node_modules are not checked; NODE_PATH clearing does not disable their resolution.
- `runner.mjs` does not gate outcome or contract execution on false isolation, symlinks, absent package identity or missing contract hash. No installed-bytes verification or explicit unverified status exists.
- Direct children still receive catchable SIGTERM. `spawnSync` may continue waiting if a POSIX child handles that signal; the current comment that it always enforces the wall-clock limit is incorrect. Only Windows behavior was exercised; do not claim Linux validation.
- Demo still omits a separately executed source baseline. No elapsed durations or exact command arrays are recorded.
- Tests return early without t.skip when npm is unavailable, so a different host could count unexecuted integrations as passes. This did not occur in the measured 42-test run.
- README is absent. PROVENANCE still contains historical text saying task 02 has not been sent; mark it historical and add current state.

The next task should close these specific evidence gaps, not add product features or invent screenshots. Positive demo behavior is now real, but reliable evidence prerequisites remain incomplete.
