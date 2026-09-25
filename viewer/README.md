# PackProof static evidence viewer

This viewer is a separate Codex contribution. IBM Bob IDE authored the core implementation; the exact core and review attribution is recorded in each report and the project provenance. The viewer displays saved evidence and does not execute the CLI, packages, source tests, or contracts.

There are no dependencies, remote fonts, analytics, telemetry, external assets, or uploads. All report text is inserted as text. The only automatic request is for `./data.json` from the same origin. Imports are read in memory in the current browser tab, without browser storage.

## Open locally

Serve this directory with any local static HTTP server, then open its URL. For example, from the repository root with Python available:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory viewer
```

Open `http://127.0.0.1:4173`. Opening `index.html` directly from the filesystem may prevent the default fetch; **Import JSON** still provides a local file workflow. Clipboard access depends on the browser and a secure/local context; when unavailable, hashes remain selectable for manual copy.

## Saved data contract

`data.json` is generated separately from authentic, sanitized PackProof reports. This viewer intentionally provides no fabricated sample records. Its envelope is:

```text
{
  generatedAt: string,                // recorded collection generation time
  sourceCommit: string,               // commit associated with the saved evidence
  sourceBaseline: object,             // optional shared source baseline record
  reports: [
    {
      ...PackProof report v1,
      expectedOutcome: "PASS" | "FAIL" | "INCONCLUSIVE"  // optional control annotation
    }
  ],
  evidenceNote: string                // optional context / sanitization explanation
}
```

Each report requires `$schema: "packproof-report-v1"`, a non-empty `caseName`, and `result.outcome` equal to `PASS`, `FAIL`, or `INCONCLUSIVE`. Sections follow `src/report.mjs`: `archive`, `consumer`, `contract`, `environment`, `verify`, and `sourceBaseline`. Missing evidence is displayed as not recorded, never silently converted to passing evidence. `archive.packedFiles`, when present, must be an array of strings. Unknown fields are preserved in downloaded JSON; unknown report schema versions are rejected.

Imports accept either a single report or the same `{ reports: [...] }` envelope. Collections are limited to 500 reports and files to 8 MB. A malformed import leaves the current collection unchanged. Process text above 120,000 characters is shortened only for display; the full supplied value remains in the JSON download. These limits constrain browser work and do not validate the report's authenticity.

An empty reports array is valid and shows an empty state. For the before/after comparison, include cases named `missing-template-operation` and `fixed-operation`. Its contract-match statement appears only when their recorded SHA-256 values match. The source-pass headline requires the missing-template case to declare `FAIL` and an applicable saved source baseline with status `pass`. Per-report source baselines take priority. If a case has no executed source baseline, a collection-level baseline appears with an explicit **shared** label; no baseline is inferred from another case.

## Reading the evidence

- **Observed outcome** is exactly the report's `result.outcome`. An intentionally failing control remains `FAIL`.
- **Expected control outcome** is a separate annotation, compared with the observed outcome without changing it.
- **Source** displays the saved baseline and its output. It is separate from consumer evidence.
- **Archive** displays the pack result, file list, and recorded archive SHA-256.
- **Consumer** displays installation and contract process evidence, copied-contract SHA-256, commands, and environment.
- **Checks** displays the recorded verification results, including any before-execution record and post-execution contract hash.

The browser does not rerun checks, validate tarball contents, recalculate hashes, verify signatures, establish timestamps, or authenticate imported reports. A hash shown on screen is a recorded value, not a cryptographic attestation by the viewer. Historical report semantics depend on the source commit and report contents; inspect the reason and full check record rather than assuming a check name guarantees a particular implementation.

The visual comparison explains the named fixture scenario. Its file-list indicator is derived from paths beneath `template/` or `templates/` in each report; it is not an archive extraction. JSON downloads preserve supplied fields and values but are reserialized, so their byte formatting can differ from the original imported file. Sanitize sensitive paths, process output, and environment values before sharing any report.

## Interaction and validation

Case buttons, file import, filters, disclosure controls, and downloads use native elements. Stage tabs support Left/Right, Home/End, and Tab. Focus indicators are visible; outcome text and symbols accompany color. The layout adapts to narrow screens and honors reduced-motion preferences. The deliberate light palette is declared with `color-scheme: light`.

Static syntax check:

```sh
node --check viewer/app.js
```

Browser verification should cover saved-data load, single and collection imports, malformed/unknown-schema JSON, empty collections, source-baseline absence, filtering, stage keys, copy/download, large text, and widths of 375, 768, and 1280 pixels. The viewer's author performed static checks; interactive headless verification is performed separately with the real saved dataset.
