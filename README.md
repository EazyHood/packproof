# PackProof

Turn a package archive and an explicit consumer contract into a reproducible
observation with recorded errors and an archive hash.

PackProof packs a fixture source directory with `npm pack`, installs the
resulting tarball into an isolated consumer in the OS temp directory, executes a
consumer contract script, and writes a versioned JSON report.  Every intermediate
fact — archive SHA-256, contract SHA-256, install stdout/stderr, contract
stdout/stderr, exit codes, verification status — is preserved in the report.
Nothing is invented.

**Outcome vocabulary:**

| Outcome | Meaning |
|---|---|
| **PASS** | Contract exited 0, all prerequisite checks passed, contract bytes unchanged |
| **FAIL** | Contract exited non-zero without infrastructure error (e.g. assertion, ENOENT for the package file under test) |
| **INCONCLUSIVE** | Any infrastructure or runner problem: pack failure, install failure, failed isolation/identity check, timeout, spawn error, changed contract bytes, unknown exit |

An intentionally failing contract (wrong assertion) is **FAIL**, not
INCONCLUSIVE.  A timeout or isolation problem is never PASS.

## Installation prerequisites

- **Node.js ≥ 18** (ESM with `node:test` built-in)
- **npm ≥ 8** — must be discoverable alongside the Node binary.  PackProof
  finds `npm-cli.js` via `NPM_EXECPATH`, adjacent to the `node` executable, or
  at the standard `lib/node_modules` location.  Set `NPM_EXECPATH` to the full
  path of `npm-cli.js` to override discovery.
- **No additional packages** are required at runtime — all dependencies are
  Node.js built-ins.

Install locally from the project root (after cloning):

```sh
npm install
```

No publication step is needed.  The `packproof` binary is registered in
`package.json` and is runnable via `node src/cli.mjs` or `npx` locally.

## Commands

### Run the test suite

```sh
node --test --test-reporter=tap test/packproof.test.mjs
```

Or with the npm script:

```sh
npm test
```

Tests that require a working `npm-cli.js` (§9 runner path-traversal regressions,
§10 end-to-end integration) are skipped automatically when npm is not found.
All other tests run without npm.

### Run the six-case demo

The demo runs every validation-fixture case and checks that each observed outcome
matches the expected outcome recorded in the README table below.

```sh
node src/cli.mjs --demo
```

Or with a custom output directory and timeout:

```sh
node src/cli.mjs --demo --out ./runs/my-demo --timeout 20000
```

Artifacts are written to a timestamped `runs/demo-YYYY-MM-DD-HH-MM/` directory
by default.

### Run a single case

```sh
node src/cli.mjs \
  --fixture  validation-fixtures/labels-fixed \
  --contract validation-fixtures/contracts/label-operation.mjs \
  --out      ./runs/my-run \
  --timeout  15000 \
  --case     "my-label-check"
```

All three of `--fixture`, `--contract`, and `--out` are required for single-case
mode.  `--case` is a metadata label stored in the report only; it does not
control any filesystem paths.

## Expected demo outcomes

| Case | Fixture | Contract | Expected |
|---|---|---|---|
| missing-template-operation | labels-missing-template | label-operation.mjs | **FAIL** |
| missing-template-import-only | labels-missing-template | label-import-only.mjs | **PASS** |
| fixed-operation | labels-fixed | label-operation.mjs | **PASS** |
| fixed-wrong-expectation | labels-fixed | label-wrong-expectation.mjs | **FAIL** |
| broken-export-operation | labels-broken-export | label-operation.mjs | **FAIL** |
| tally-operation | tally | tally-operation.mjs | **PASS** |

`label-wrong-expectation.mjs` always fails even with the fixed package — a FAIL
is the correct expected outcome, not a runner problem.  `label-import-only.mjs`
passes because it does not invoke the resource-backed operation; it records
`operationExercised: false`.

## Output paths

Each run creates a unique subdirectory under the artifact parent, named by a
UUID.  Contents:

```
<artifactDir>/<uuid>/
  report.json        ← versioned JSON report (schema: packproof-report-v1)
  archive/
    <package>.tgz    ← the archive produced by npm pack
```

The consumer directory is allocated in the OS temp directory (`os.tmpdir()`) and
is not cleaned up by PackProof — it is left on disk for inspection.  The path is
recorded in `report.json` under `consumer.consumerDir`.

To inspect a run:

```sh
# Read the report
cat <artifactDir>/<uuid>/report.json

# Check contract stdout/stderr
node -e "const r=JSON.parse(require('fs').readFileSync('<uuid>/report.json'));console.log(r.contract.stdout)"
```

## Inspectable temporary data

The following are left on disk after a run:

- `<artifactDir>/<uuid>/archive/*.tgz` — the packed archive
- `<os.tmpdir()>/packproof-consumer-<rand>/` — the installed consumer
  - `contract.mjs` — the exact contract bytes that were executed (hashed before execution)
  - `node_modules/<package>/` — the installed package
- `<os.tmpdir()>/packproof-cache-<uuid>/` — private npm cache for this run

None of these are cleaned up automatically.  They are safe to delete after
inspection.

## Trusted-fixture-only scope

PackProof is designed for **trusted local fixtures only**.  It does not:

- sandbox the contract or package in any way
- prevent a contract from reading or writing files outside its directory
- prevent a package lifecycle script from running (install is `--ignore-scripts`)
- validate that installed bytes match the tarball byte-for-byte (package.json
  presence is verified; full extraction comparison is not performed)
- kill descendant processes spawned by the contract (only the direct child
  `node` process is killed on timeout)

Do not point PackProof at untrusted fixtures or contracts.

## Verification checks recorded in the report

Each run records explicit verification results in `report.verify`:

| Check | Required | Failure → |
|---|---|---|
| `isolation` | Yes | INCONCLUSIVE |
| `identity` | Yes | INCONCLUSIVE |
| `contractHash` | Yes | INCONCLUSIVE |
| `installedBytes` | No | Recorded, not blocking |

- **isolation** — consumer realpath is outside the fixture source directory; no
  ancestor `node_modules` directory is present between OS root and consumer; the
  installed package entry is not a symlink.
- **identity** — the package installed under `node_modules` has the name that
  `npm pack` reported.
- **contractHash** — the contract file bytes are hashed before execution and
  re-checked after; a changed file yields INCONCLUSIVE.
- **installedBytes** — `package.json` is present and parseable in the installed
  package directory (full tarball byte-comparison is not performed; this is
  explicitly recorded as `unverified` in the reason string).

## Platform limitations

Tested on **Windows (Node v24 / npm 11)** and targeted at POSIX as well.

Known limitations:

- **Descendant processes are not killed on timeout.** Only the direct `node`
  contract process receives SIGKILL (Windows: forcible termination).  Child
  processes spawned by the contract continue running.
- **npm discovery may fail** if npm is installed in an unusual location.  Set
  `NPM_EXECPATH` to the absolute path of `npm-cli.js` to override.
- **Full archive integrity is not verified.** PackProof does not unpack and
  compare every tarball entry to the installed files.  The presence and
  parseability of the installed `package.json` is checked; further byte-level
  comparison is deferred.
- **Case-insensitive filesystem handling is partial.** Isolation checks
  normalise paths with `toLowerCase()` for containment comparison on Windows.
  Unusual filesystem configurations may require manual inspection.
- **Source baseline runs once per demo.** The baseline is attached to the first
  demo case report only.  In single-case mode without `--source-baseline`, the
  field is `{ status: "not-run" }`.

## Validation commands (for Codex)

Run from the project root:

```sh
# Unit and integration tests (skip npm-dependent tests when npm not found)
node --test --test-reporter=tap test/packproof.test.mjs

# Full demo (requires npm)
node src/cli.mjs --demo

# Single case smoke test (requires npm)
node src/cli.mjs \
  --fixture  validation-fixtures/labels-fixed \
  --contract validation-fixtures/contracts/label-operation.mjs \
  --out      ./runs/smoke \
  --case     smoke-fixed-operation

# Source tests only (Codex fixture tests, independent of PackProof runner)
node --test --test-reporter=tap validation-fixtures/source-tests.test.mjs
```

Exit 0 means all checked cases matched their expected outcome.
