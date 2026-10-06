# Human review of skill outputs

Use this reference when creating or improving a skill's output contract, selecting a format, or evaluating the user's understanding. The examples below are applications of these principles; do not attribute them to Karpathy or present them as examples from his post.

## Define an output contract

Every skill must specify how its final output communicates these four items. Adapt the labels to the task; four long sections are not required.

| Item        | What the user must be able to inspect                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Result      | What changed or what the skill found, including whether the requested outcome is complete, partial, or blocked.                                                                      |
| Evidence    | What was actually verified, the observed result, and a source link, file location, test result, or other inspectable evidence for each material claim.                               |
| Uncertainty | What remains unknown or untested. Label assumptions and inferences separately from verified facts. If no additional uncertainty is known, state that within the scope of the checks. |
| Decision    | The specific action needing the user's approval, if any. If none is required, state “No approval needed.” Do not create an approval gate for an already authorized action.           |

Put the main result first. Match each completion claim to the evidence's scope. Include failures and blockers in the summary, even when detailed evidence is expandable.

For example, in a Paperclip invite workflow, a valid invite API response supports “invite generated.” It does not support “owner access confirmed.” Confirm owner access only after observing successful invite acceptance and the expected owner permissions. If those checks were not run, report them as untested. If acceptance needs a user action, name that action separately from any approval decision.

## Choose the format by the review task

Honor an explicit user format request. Otherwise, choose the simplest format that makes the result easy to inspect:

| Review task                  | Default format                                      | Selection condition                                                                                                                                       |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick operation              | Concise text with checks and blockers               | The user can inspect the result without navigating a separate artifact.                                                                                   |
| Architecture or dependencies | A diagram with a brief explanation                  | Relationships, boundaries, or dependencies are central to the review.                                                                                     |
| Comparisons or research      | An HTML report with filters and expandable evidence | Multiple candidates or findings require repeated filtering or evidence inspection. Use a text table for a small comparison that can be inspected at once. |
| Teaching a complex process   | An animation or narrated explainer                  | Produce this format when the user requests it. Otherwise use text or a diagram.                                                                           |

Do not require a long Markdown report or multimedia for every skill. If the requested format cannot be produced with available tools, disclose the limitation and deliver the inspectable content in a supported format. Preserve the four contract items in any fallback.

Step Completion Reports remain compact progress checks. They do not dictate the final artifact's format or replace its output contract. For skill evaluation, keep using `eval-viewer/generate_review.py`; an interactive report produced by the evaluated skill is a separate artifact.

## Make complex reports interactive

When the report requires filtering across candidates or repeated inspection of supporting evidence, use an interactive HTML report. Keep the main result and material uncertainty visible before any interaction.

- Provide filters for the fields the user uses to make the decision.
- Put detailed evidence in expandable sections beside the associated claim.
- Show the reason each candidate or finding met or failed the stated criteria.
- Link to original evidence. Label missing evidence as unavailable.
- Show the number of visible results. Provide a way to reset filters.
- Distinguish missing values from values that fail a criterion.

For an AI job scout, useful filters include salary, remote policy, and equity. Expandable details can hold company funding and product research. Each role should show why it qualified or failed and link to the original evidence.

For a code review, connect each finding to its file location, relevant test and observed test status, severity, and proposed fix. Label a proposed but unrun test as untested.

Before delivery, exercise each filter, expansion control, and reset control. Check that filtering preserves the correct association between a result and its evidence. Verify that source links target the cited evidence. If browser interaction or source access is unavailable, report the affected checks as untested.

## Evaluate understanding alongside correctness

For every eval that applies the skill, assess these four criteria using the delivered output. Exclude negative-trigger evals, which check that the skill was not applied.

| Criterion                           | Observable check                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Main result is immediately findable | The opening text or initial view states the result and completion status without requiring expansion or a search through logs.                |
| Facts and assumptions are separated | Verified claims name the checks performed; assumptions, inferences, and untested behavior carry explicit labels.                              |
| Claims are traceable                | Each material claim points to evidence that supports that claim's scope. Intermediate success is not presented as proof of the final outcome. |
| Next decision is clear              | The output names the action requiring approval, or explicitly states that no approval is needed. Any remaining user action is also named.     |

Add these as review assertions alongside task-correctness and process assertions. Cite output evidence when grading them. Heading presence alone does not pass a criterion. For interactive artifacts, include assertions that exercise the controls and preserve claim-to-evidence links.

Ask the human reviewer whether they could locate the main result, distinguish facts from assumptions, trace claims, and identify the next decision. The eval viewer's Understanding check records a Yes / No / N/A answer per criterion in `feedback.json`; `references/eval-loop.md` → _Step 5_ explains how to read it. Agent grading checks the observable conditions; it does not prove human understanding. If no human review occurred, label understanding as unconfirmed.
