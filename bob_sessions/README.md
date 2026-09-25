# Bob session evidence

The [genuine Bob IDE consumption-summary screenshot](EazyHood-task-01-packproof-consumption.jpg) was captured on **25 September 2026 at 21:05:32.783 UTC / 16:05:32.783 COT**. See the [evidence index](index.md) for its task ID, hash and observed consumption.

The UI inventory check used Tasks → View all with an empty search. It showed two entries under Today: **one relevant development task covering phases 01–03**, and an unrelated authentication-help conversation that is excluded from public evidence. No additional items or workspaces were visible. `BOB_TASK_01`, `BOB_TASK_02` and `BOB_TASK_03` name instruction phases, not three separate Bob tasks. The screenshot shows the phase 01 opening prompt and phase 03 content in the same task.

| Work phase / prompt | Bob work | Independent validation by Codex | Evidence |
|---|---|---|---|
| BOB_TASK_01 | CLI, archive/install/contract/report pipeline and original tests; commit `3ab678e` | At this snapshot: 23 tests pass; six-case demo is INCONCLUSIVE at npm pack on Windows. Repaired in phase 02. | Same observed development task; [summary](EazyHood-task-01-packproof-consumption.jpg) |
| BOB_TASK_02 | Windows npm execution repairs, unique run paths, raw output and tests; commit `51b4837` | 42 tests pass and six demo cases match. Two independent evidence controls falsely return PASS; see `BOB_REVIEW_02.md`. | Same observed development task; [summary](EazyHood-task-01-packproof-consumption.jpg) |
| BOB_TASK_03 | Original verification module, contract rehash, source baseline and README; commit `d246d37` | Original: 48/49 tests pass and six demo cases match. Separately attributed Codex corrections subsequently pass 64/64 tests. | Same observed development task; [summary](EazyHood-task-01-packproof-consumption.jpg) |

The task summary displays **30.16 Bobcoins** and context **66.0k / 270.0k (24%)**. The Bobcoin figure is task consumption observed at capture time. It is not a dollar amount, an account balance or a measured split between the three phases. No per-phase consumption is inferred.

The original Bob implementation and its repair snapshots are preserved separately from the final Codex corrections. The independent fixtures, tests executed by Codex, final integrity fixes, viewer and submission assets are attributed in [PROVENANCE.md](../PROVENANCE.md). The screenshot does not prove Bob ran the tests; Bob was instructed not to run commands, and Codex performed the validation independently.

At the earlier implementation and review stages on 25 September, this directory contained only a provenance note and no screenshot. That historical absence has been superseded by the genuine capture above. Preserve all relevant real task summaries, including failed tasks, and add further captures if later work creates additional development tasks. Do not include the earlier authentication-help conversation or access codes, manufacture screenshots, or infer Bobcoin consumption from context/token estimates.

Starting sponsor account was observed on 25 September 2026 with a 40 Bobcoin limit, 0 used and 40 remaining. That earlier subscription check was not a development session and does not establish the current account balance.
