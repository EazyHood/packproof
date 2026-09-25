# Verified scope — 25 September 2026

Environment: Windows, Node 24.16.0, npm 11.13.0. Tests and observations were executed independently by Codex after IBM Bob tasks 01–03 and separately attributed final evidence corrections.

- `node --test --test-reporter=tap ./test/*.test.mjs`: **64 passed, 0 failed, 0 skipped**.
- `node src/cli.mjs --demo --out <fresh artifact parent>`: exit **0**; six observed contract outcomes matched the frozen matrix.
- Frozen source baseline: **5 passed**, executed once by the demo and recorded independently of consumer outcomes.

| Saved consumer observation | Outcome | Meaning |
|---|---|---|
| Missing template, real operation | FAIL | ENOENT from resource omitted by the archive |
| Missing template, import-only | PASS | Incomplete contract does not exercise the resource |
| Fixed file inclusion, same operation | PASS | Exact frozen label output including LF |
| Fixed package, intentionally wrong expected label | FAIL | Incorrect expectation remains a failure |
| Broken public export | FAIL | Real import cannot load the advertised target |
| Independent CommonJS tally | PASS | totalUnits 11, lineCount 2 |

Verification regressions cover archive bytes, extra installed files, unsupported or malformed archives, scoped-package path containment, absent evidence, changed executed contract, unreadable copied contract, mutated installed package, timeouts and unknown completion. Both original false-PASS cases were reproduced and corrected.

These observations apply to the synthetic fixtures and this host. No speed improvement, customer adoption, production sandbox, universal API coverage or Linux validation is claimed. An expected FAIL is a correctly behaving control, not a package ready for release. Reports are saved evidence, not independently signed attestations.

Original Bob task snapshots are retained in git: task 01 `3ab678e`, task 02 `51b4837`, task 03 `d246d37`. See PROVENANCE.md for contributor boundaries and bob_sessions/README.md for the still-missing genuine consumption-summary screenshots.
