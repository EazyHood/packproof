# Independent validation fixtures

Original synthetic packages and explicit contracts written by **Codex on 25 September 2026**, separately from the PackProof runner that IBM Bob is to implement. See [PROVENANCE.md](PROVENANCE.md). This directory is not the PackProof implementation or evidence of Bob usage.

There are no runtime dependencies, lifecycle scripts, credentials, personal data or remote services. Nothing is published to npm. Run only these trusted local fixtures; installing into a clean directory is not a security sandbox.

## Frozen contracts

`formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' })` must return exactly `SKU-042 | QTY 12 | BIN B-7\n`, including the final LF. This expectation is the same before and after the packaging fix.

| Fixture | Structure | Intended observation |
|---|---|---|
| `labels-missing-template` | ESM entrypoint `src/index.mjs`; template exists in checkout but `files` includes only the entrypoint. | Direct source operation passes; installed operation fails with ENOENT. Import alone passes because the resource is loaded only when called. |
| `labels-fixed` | Identical ESM source and template; only `files` changes to include `src`. | Installed operation yields the exact frozen output. |
| `labels-broken-export` | Same code/resources and fixed file list, but `exports` points to `dist/not-here.mjs`. | Direct source operation passes; public installed import fails. |
| `tally` | CommonJS `lib/summary.cjs` with `data/units.json`, accessed through `main`. | Two crates of four units plus three units produces `{ totalUnits: 11, lineCount: 2 }`. |

The label packages deliberately share a name and version so the same consumer contract is used unchanged. Install each into its own fresh consumer. Never install variants successively into the same directory.

`contracts/label-wrong-expectation.mjs` expects quantity 999 and **must fail even with the fixed package**. `contracts/label-import-only.mjs` passes without invoking the resource-backed operation and therefore proves the limit of incomplete coverage. An expected failure is not a working package.

## Recorded manual baseline

Executed with **Node v24.16.0, npm 11.13.0, Windows**, beginning 2026-09-25 10:26 COT. Raw records are in [evidence/manual-2026-09-25-1030](evidence/manual-2026-09-25-1030). The folder suffix is a run identifier; `environment.json` and individual observations contain the actual timestamps.

- Source tests: **5 passed, 0 failed**, including the byte-identical source check.
- All four packages packed successfully. Every consumer installed its local tarball using `--offline --ignore-scripts --no-audit --no-fund`.
- Each consumer has its own installed package, with no symlink; recorded resolved paths point inside that consumer. The archive SHA-256 and contract SHA-256 are recorded separately.

| Consumer case | Install exit | Contract exit | Observed result |
|---|---:|---:|---|
| missing-template-operation | 0 | 1 | ENOENT for installed `src/templates/label.txt` |
| missing-template-import-only | 0 | 0 | Import passes, `operationExercised: false` |
| fixed-operation | 0 | 0 | Exact frozen label output |
| fixed-wrong-expectation | 0 | 1 | AssertionError, actual quantity 12 versus expected 999 |
| broken-export-operation | 0 | 1 | ERR_MODULE_NOT_FOUND for installed public entrypoint |
| tally-operation | 0 | 0 | Exact total 11 and line count 2 |

See `observations.json`, each consumer's `contract.stdout.txt`/`contract.stderr.txt`, and `artifacts/*/pack.stdout.json` for raw observations and archive file lists. `observedAsExpected: true` means a control behaved as predicted; it does **not** change a failing contract into PASS. This is one baseline run on one host, not a performance study or an executed comparison with publint/ATTW.

## Reproduce manually in PowerShell

Run from this directory. These are ordinary npm/Node commands independent of PackProof. No PackProof CLI is needed.

```powershell
node --test --test-reporter=tap ./source-tests.test.mjs

$fixtureRoot = (Get-Location).Path
$manualId = [guid]::NewGuid().ToString('N')
$manualRun = Join-Path $fixtureRoot "evidence/manual-baseline-$manualId"
$manualArchiveDir = Join-Path $manualRun 'artifacts'
$manualConsumer = Join-Path $manualRun 'consumer'
New-Item -ItemType Directory -Path $manualArchiveDir,$manualConsumer -Force | Out-Null
$env:NPM_CONFIG_CACHE = Join-Path $manualRun 'npm-cache'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
$env:NPM_CONFIG_USERCONFIG = Join-Path $manualRun 'empty.npmrc'
[System.IO.File]::WriteAllText($env:NPM_CONFIG_USERCONFIG, '')
$env:NODE_PATH = ''
$env:NODE_OPTIONS = ''

# Pick ONE row from the matrix below. Each repetition needs a fresh run.
$fixtureName = 'labels-missing-template'
$contractName = 'label-operation.mjs'
Push-Location -LiteralPath (Join-Path $fixtureRoot $fixtureName)
npm pack --ignore-scripts --json --pack-destination "$manualArchiveDir"
if ($LASTEXITCODE -ne 0) { throw 'Pack failed: baseline is inconclusive' }
Pop-Location
$manualArchive = Get-ChildItem -LiteralPath $manualArchiveDir -Filter '*.tgz' | Select-Object -First 1
Get-FileHash -LiteralPath $manualArchive.FullName -Algorithm SHA256
[System.IO.File]::WriteAllText((Join-Path $manualConsumer 'package.json'), '{"name":"manual-consumer","private":true,"type":"module"}')
Copy-Item -LiteralPath (Join-Path $fixtureRoot "contracts/$contractName") -Destination (Join-Path $manualConsumer 'contract.mjs')
Push-Location -LiteralPath $manualConsumer
npm install --ignore-scripts --offline --no-audit --no-fund --package-lock=false --save=false "$($manualArchive.FullName)"
if ($LASTEXITCODE -ne 0) { throw 'Install failed: baseline is inconclusive' }
node ./contract.mjs
$manualContractExit = $LASTEXITCODE
Pop-Location
Write-Output "Contract exit: $manualContractExit"
```

| `$fixtureName` | `$contractName` | Expected contract exit |
|---|---|---:|
| labels-missing-template | label-operation.mjs | 1 |
| labels-missing-template | label-import-only.mjs | 0 |
| labels-fixed | label-operation.mjs | 0 |
| labels-fixed | label-wrong-expectation.mjs | 1 |
| labels-broken-export | label-operation.mjs | 1 |
| tally | tally-operation.mjs | 0 |

For a successful installed label import, `node --input-type=module -e "console.log(import.meta.resolve('@packproof/labels'))"` from the consumer shows the resolved installed entrypoint. Use `@packproof/tally` for the second package. Keep failures and exact archives inspectable. Disposable `node_modules` and npm cache are excluded from version control; reproduce them from the preserved archives. No cleanup command is necessary.

These manually executed baselines have no runner timeout or invalid-input control. Those belong to the forthcoming PackProof implementation and remain untested here. Do not claim they are complete based on these fixtures.
