# PackProof — implementation brief

IBM Bob 2.0 Hackathon, 25–27 September 2026. This file is planning written by Codex; it is not evidence of Bob usage or a working implementation.

## User and outcome

A small npm library maintainer needs to know whether the archive users install still performs its documented job. Local source tests can pass while the published archive omits a required template or exposes an unusable entry point. PackProof should turn a package archive and an explicit consumer contract into a reproducible observation with recorded errors and an archive hash.

## Scope

- Node.js 24 CLI, npm, minimal dependencies, portable to Windows and Linux.
- Only original, trusted local fixture packages in the demo. Executing an installed package is NOT a security sandbox. No arbitrary repository upload, remote code execution service, or npm publication.
- Pack the fixture using npm with lifecycle scripts disabled. Record the exact archive file, contents, SHA-256 and tool versions. Install that archive, not a symlink to the source, into a new temporary consumer directory with install scripts disabled. Run the explicit consumer contract with a timeout and capture stdout, stderr and exit status.
- Distinguish contract pass, demonstrated contract failure, and inconclusive infrastructure/runner error. Missing reports, skipped checks and timeouts are never passes.
- Keep the source baseline, archive run and repaired archive run separate. Attach each run to the artifact it really used, with no stale report substitution.
- Produce a versioned JSON report suitable for a later static report viewer. No fabricated durations or success values. Do not claim user validation, ROI, universal coverage or production security.

## Demo fixtures and controls

Independent audit note: `import.meta.resolve()` can return a nonexistent export target. It is useful for tracing resolution but is not proof that an import succeeded. Execute the actual consumer operation. Likewise, `observedAsExpected: true` means a test control behaved as predicted; a deliberately failing contract still has a FAIL outcome.

Create all fixture code during this event. Use fictional inventory labels and no personal data.

1. A small ESM label library loads a template adjacent to its source. Source tests pass. Its broken packaging omits the template and the consumer's real operation fails. A fixed variant includes it and yields the exact same specified output. The consumer expectation must not be weakened to make the fix pass.
2. An independently structured, small package supports checking that the runner is not hard-coded to the first package or name.
3. A broken export is detected by the consumer. Existing metadata tools should be run separately by Codex for fair attribution.
4. An intentionally wrong consumer expectation remains a failure even after fixing the archive.
5. Missing or invalid input and a deliberately hanging contract produce clear non-success outcomes and terminate within a bounded time.

Use isolated disposable run directories under the project. Never delete user files or unrelated directories. Make cleanup optional initially; keep failures inspectable. No network dependencies in fixture packages. Escape output when later presenting report content in HTML.

## Responsibility and provenance

An independent Codex validation task created original fixture packages and fixed consumer contracts under `validation-fixtures/` and ran a manual baseline. Inspect and reuse those reference cases where appropriate instead of overwriting their expected values to satisfy the runner. They are support material, not an implementation of PackProof. The public provenance must credit them separately. Git attributes preserve LF template bytes across Windows and Linux checkouts because exact expected output includes a newline.

Bob IDE must perform substantive design and core implementation, then diagnose/repair and review regressions. Codex coordinates, prepares this brief, runs independent shell verification through its own execution tools, reviews, builds presentation assets and handles the final submission. Do not pretend all work was done by a human or by Bob alone.

Do not execute terminal or shell commands from Bob's UI agent. Use file reading/editing tools inside this project; Codex runs validation separately. Do not read parent directories, credentials or unrelated files. Do not install extensions, create accounts, publish or spend money.

After each meaningful Bob task, preserve the genuine consumption summary screenshot in bob_sessions and record what changed. 40 sponsored Bobcoins are available at the start; never use a personal plan or request paid overages.

## Acceptance criteria for the first implementation

- CLI usage and package scripts documented; missing input fails clearly.
- A repeatable demo writes authentic before/fixed/control JSON reports.
- Core tests validate behavior, isolation and fail/inconclusive distinctions.
- The positive control passes, missing-template case fails after install, repaired package passes, wrong contract fails, and timeout does not hang or pass.
- No false claims, invented evidence, hidden network service, or automatic publication.
