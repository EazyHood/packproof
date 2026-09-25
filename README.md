# PackProof

**Source tests passed. Does the archive still do the job?**

[Explore the live evidence viewer](https://eazyhood.github.io/packproof/) · [Validation](VALIDATION.md) · [IBM Bob session evidence](bob_sessions/index.md)

PackProof packages a trusted local npm fixture, installs its exact tarball in a fresh consumer, and executes an explicit consumer contract. It preserves the archive hash, file list, installed-byte comparison, contract hashes, outputs and verification results in a JSON report.

The demo uses a small label library whose source can read a template that the broken archive omits. The same consumer expectation fails after install, then passes when the template is included. Importing alone misses this defect. A separate CommonJS package and deliberate negative controls keep the demonstration honest.

## Run locally

Requires **Node.js 24 or newer** and npm. Verified environment is Windows with Node 24.16.0 and npm 11.13.0; Linux is a portability target, not a verified platform. No dependency installation is required.

```sh
npm test
node src/cli.mjs --demo --out ./runs/demo
node src/cli.mjs --fixture validation-fixtures/labels-fixed --contract validation-fixtures/contracts/label-operation.mjs --out ./runs/single
```

Run from the cloned repository. The fixtures are needed for `--demo` and are deliberately not included in the npm package file list. No npm publishing or `npx` download is necessary.

Set `NPM_EXECPATH` to a valid absolute npm-cli.js path if discovery alongside Node fails. The CLI executes npm through Node with argument arrays and no shell. Installing the archive uses `--offline --ignore-scripts`; fixture packages have no network dependencies. Contracts run in new OS temporary directories with NODE_PATH and NODE_OPTIONS cleared.

## Read the result

The static viewer in `viewer/` includes six genuine saved reports from the verified Windows run, with personal host paths redacted. It compares the omitted-template archive with the repaired archive and exposes commands, output, hashes and checks. It also accepts your own report JSON locally; it does not execute packages in the browser. See [viewer/README.md](viewer/README.md) for controls and the report format.

With Python available, serve it from the repository root:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory viewer
```

Open `http://127.0.0.1:4173`. To replace the saved collection after running a new demo, run `node scripts/export-viewer.mjs <demo-summary.json>` from the checkout used for that execution. The exporter records the current commit and redacts common local user paths; review outputs for other private data before sharing.

| Outcome | Meaning |
|---|---|
| PASS | The explicit contract exited zero and required evidence checks passed. |
| FAIL | The contract completed with a nonzero exit, such as a real assertion or missing resource error. |
| INCONCLUSIVE | The runner cannot support a conclusion: timeout, missing tool, isolation failure, changed evidence or another infrastructure problem. |

An expected FAIL is a successful **control**, not a working package. The six demo cases are: missing-template operation FAIL; missing-template import-only PASS; repaired operation PASS; deliberately wrong assertion FAIL; broken export FAIL; separate tally operation PASS. Demo exit zero means this matrix matched **and** the frozen source baseline passed. It does not mean every package passed.

PASS covers only what the supplied contract exercises. The import-only control intentionally demonstrates this limit.

## Evidence and verification

Each invocation creates a unique `<out>/<UUID>/` containing `report.json` and `archive/*.tgz`. Repeated commands retain earlier evidence. Case labels are metadata and never file paths. Demo also writes a unique `demo-summary-<UUID>.json` linking the reports and actual source baseline.

Reports preserve process outcomes separately from the overall result. Required verification checks include:

- Consumer realpath outside the fixture source, no ancestor node_modules candidates, expected installed package identity and path containment.
- Byte comparison of supported regular archive members against the installed files. Unsupported archive constructs are rejected instead of accepted as verified.
- Hash of the copied consumer contract before and after execution. A missing, unreadable or changed copy invalidates the conclusion.
- Verification after the operation as well as before it. A changed installed package cannot keep a PASS based on earlier bytes.

The source baseline runs once per demo with actual command, script hash, output, exit and timing. Single-case mode labels it `not-run`. Archives, npm caches and consumers are left inspectable; their exact paths are in the reports. Cleanup is manual and must target only the specific generated directories.

## Limits

This is **trusted local execution, not a security sandbox**. Contracts and installed modules can access the host. Disabling npm lifecycle scripts does not restrict the code invoked by the contract. Direct child processes have finite timeouts; descendant process containment is not guaranteed. Do not supply untrusted packages or contracts.

Archive comparison supports a deliberately bounded subset of local npm tarballs; unsupported links or formats yield INCONCLUSIVE. Matching hashes are integrity observations, not signatures or proof that an independent party produced a report. Reports and the viewer display saved executions; they do not run Node inside the browser.

The baseline comprises synthetic fixtures, not customer usage or a performance study. Existing tools such as publint detect metadata/export problems, and a manually installed consumer also detects the omitted template. PackProof's contribution is repeatable execution with organized evidence, not exclusive detection or measured productivity savings.

## Provenance

IBM Bob IDE implemented the CLI and report pipeline through phases 01–03 in one development task. Codex specified independent fixtures, executed baselines, reviewed the implementation, corrected remaining evidence edge cases and prepared presentation assets. See PROVENANCE.md and bob_sessions/README.md for the actual state of session evidence. No screenshots, usage totals or prizes are inferred from code changes.
