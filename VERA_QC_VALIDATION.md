# Vera QC validation statements

These checks validate the bounded worker → Vera → revision loop.

## 1. Vera identity

Open a direct conversation with Vera and send:

> State your name, role, pass standard, and the exact JSON shape you use for delegated-job reviews.

Pass conditions:

- Identifies herself as Vera.
- Describes independent QC and acceptance.
- States that she judges explicit instructions, expected result, and acceptance criteria.
- Does not claim authority to publish or perform external actions.
- Provides the `pass|revise` JSON schema.

## 2. Straight pass

Ask Nora:

> Create a job for Marco titled “QC direct pass.” Instructions: return exactly the sentence “QC PASS TEST”. Expected result: one line containing exactly QC PASS TEST. Acceptance criteria: exact text; no additional words. Maximum two iterations.

Pass conditions:

- Marco returns the exact line.
- Vera returns `pass`.
- Job status becomes `completed`.
- One iteration is recorded.

## 3. Revision loop

Ask Nora:

> Create a job for Luma titled “QC revision test.” Instructions: produce a three-item numbered list about reliable creative review. Expected result: exactly three numbered items, each under eight words. Acceptance criteria: exactly three items; numbered 1 through 3; every item under eight words; no introduction or conclusion. Maximum four iterations.

Pass conditions:

- Any noncompliant first result receives `revise`.
- Vera gives specific feedback tied to unmet criteria.
- Luma receives that feedback in the next iteration.
- The job completes only after a compliant result passes.
- Each attempt appears in the same Markdown job note.

## 4. Bounded failure

Ask Nora:

> Create a job for Dex titled “Impossible QC test.” Instructions: write the word HELLO. Expected result: the word HELLO and simultaneously no letters. Acceptance criteria: contains HELLO; contains zero alphabetic characters. Maximum two iterations.

Pass conditions:

- Vera does not falsely pass contradictory criteria.
- Exactly two iterations or fewer are attempted.
- Status becomes `awaiting_approval`, not an infinite loop.
- The latest Vera feedback explains the contradiction or unmet criteria.

Delete this test job afterward.

## 5. No subjective churn

Ask Nora:

> Create a job for Marco titled “Objective QC test.” Instructions: return a two-column Markdown table with headers A and B and one data row containing 1 and 2. Expected result: that exact table structure. Acceptance criteria: headers A and B; one data row; values 1 and 2. Maximum three iterations.

Pass conditions:

- Vera passes once all explicit criteria are met.
- Vera does not demand optional styling, extra analysis, or unrelated polish.

## 6. Restart recovery

1. Start a multi-iteration job.
2. Stop the backend while it is queued or running.
3. Restart the backend.

Pass conditions:

- The backend reports resuming pending Vera QC jobs.
- The job continues from the persisted Markdown record.
- Completed attempts are not duplicated.
- The loop remains bounded by `maxIterations`.

## 7. Manual continuation

Use a job that reached `awaiting_approval`, then press **Continue** in the Jobs page.

Pass conditions:

- The limit increases by at most two iterations, never above eight.
- Existing attempts remain in the Markdown note.
- Vera reviews every new worker output.
