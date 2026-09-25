# Bob task evidence index

The capture retains the original JPEG bytes returned by the screenshot tool, without conversion, cropping or pixel edits.

Inventory checked through Bob IDE on 25 September 2026: **one relevant development task, covering phases 01–03**. Tasks → View all, with an empty search, showed two entries under Today: the development task and an unrelated authentication-help conversation. The latter is excluded. No additional items or workspaces were visible in that inventory.

## Observed development task 01 — PackProof implementation and repairs

| Field | Observed record |
|---|---|
| Screenshot | [EazyHood-task-01-packproof-consumption.jpg](EazyHood-task-01-packproof-consumption.jpg) |
| Capture time | `2026-09-25T21:05:32.783Z` / 25 September 2026, 16:05:32.783 COT |
| Bob task ID | `ae46bb0c03f96cc7a555a0df32cc4c4b` |
| Workspace | `packproof` |
| Task Bobcoins displayed | `30.16` |
| Context displayed | `66.0k / 270.0k (24%)` |
| Work phases covered | `BOB_TASK_01`–`BOB_TASK_03`; opening phase 01 prompt and phase 03 content are visible in the same task |
| Bob snapshots | `3ab678e` (phase 01), `51b4837` (phase 02), `d246d37` (phase 03) |
| Screenshot SHA-256 | `443d3f9ea6edb39e934d4a16a32cdfe8fdd2a1cfd472c2780cb047c4ff69d5d5` |
| Capture method | Original screenshot of the Bob IDE task consumption summary, captured through the UI with the user's explicit authorization; no visual alteration |

Bob created the substantive CLI and archive/install/contract/report pipeline, then repaired Windows execution and added verification/reporting improvements. The file-level attribution is in [PROVENANCE.md](../PROVENANCE.md).

Codex independently validated the three preserved implementation snapshots. After the phase 03 snapshot, Codex completed the separately attributed integrity checks and regression fixes; the final Windows validation passed **64 tests with 0 failures and 0 skipped tests**, all **six demo outcomes matched**, and the source baseline passed. These test runs were performed by Codex, not by Bob. The original Bob phase 03 limitations remain visible in the screenshot and are not claims about the subsequent corrected version.

The `30.16` value records task Bobcoins at capture time. It is not USD, an account balance or a verified account-wide total. The three instruction phases do not imply three separate tasks or three measured consumption figures. The hash identifies this saved screenshot's bytes; it is not a third-party attestation.

Do not add authentication-help tasks or access codes to public evidence. If future work creates additional relevant development tasks, add their genuine summaries and separate records here.
