# Controlled instructions and human-review audit

Apply this audit to every target as part of Gate 1: inspect before edits in Phase 0, fix in Phase 2, and re-check after each iteration or Mode 2 conversion. This local checklist works even when the acquired skill-creator predates its human-review guidance.

Record five rows: check, target evidence (`path:line`), status (`pass`, `fail`, or `not applicable`), edit made, and re-check evidence. Save the baseline to `.asm-improver/baseline-human-review.md` and the latest state to `.asm-improver/human-review-audit.md`. On a no-edit exit, copy the baseline as the latest state. A missing or uninspected requirement cannot pass. Only check 4 may be not applicable, with a reason tied to the target's output.

These are required **target instruction checks**, not optional recommendations or a third gate. Repair every failure in the target's SKILL.md, references, templates, or eval guidance. Keep the target self-contained: do not point it at this improver's installed files. If a repair needs missing information or unauthorized scope, record a Gate 1 blocker with the specific decision needed. Do not claim full completion while an applicable check remains failed.

## Detect, repair, and re-check the target

| Check                          | Detect a failure                                                                                              | Required target edit                                                                                                    | Re-check evidence                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Controlled instructions     | Compound actions, inconsistent names, hidden conditions, or vague completion adjectives.                      | Rewrite the affected instructions using the rules below.                                                                | Cite the repaired instructions and observable completion conditions.                                                       |
| 2. Output contract             | Final output omits result, evidence, uncertainty, or decision.                                                | Add or repair the target's final-output instructions and any conflicting template.                                      | Cite where all four items are required.                                                                                    |
| 3. Format selection            | A fixed long report or multimedia format does not fit the review task, or no suitable format is specified.    | Set the simplest suitable default and explicit conditions for alternatives or tool limitations.                         | Cite the format rule and applicable conditions; a fixed concise format can pass.                                           |
| 4. Interactive complex reports | A target requiring repeated filtering or evidence inspection has no interaction or verification requirements. | Add task-specific filters, expandable evidence, qualification reasons, source links, and delivery checks.               | Cite the controls and checks. For a quick operation or other noninteractive task, record why this check is not applicable. |
| 5. Understanding criteria      | Target evaluation guidance checks correctness only.                                                           | Add the four review criteria below to its acceptance/evaluation guidance; extend existing eval assertions when present. | Cite each criterion and the handling of absent human feedback.                                                             |

Inspect the target's actual workflow and output examples before selecting edits. Do not copy job-scout fields into unrelated skills. Re-check the edited files rather than treating new headings as sufficient. Passing these instruction checks does not imply that target behavior was executed or human understanding was confirmed; report those separately as untested or unconfirmed.

## 1. Write controlled instructions

Use the practical parts of a softened ASD-STE100 approach. Do not demand formal compliance.

- Write one action per instruction.
- Reuse the same name for the same concept.
- State each condition before its action. State exceptions and their handling explicitly.
- Replace vague adjectives with observable checks: input, expected result, and failure response.

Weak: “Ensure the deployment is secure and working.”

Better:

1. Request the protected API without credentials.
2. Check for HTTP 401 or 403. If neither is returned, report an access-control failure.
3. Request the dashboard.
4. Check for HTTP 200. If another status is returned, report an availability failure.

These checks verify only the stated HTTP behavior, not the security or functionality of the entire deployment. Rewrite ambiguous instructions in place; do not add a generic clarity section to every target.

## 2. Define the human-review output contract

Require the target's final output to communicate these four items. Use compact text where sufficient; four long sections are unnecessary.

| Item        | Observable content                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Result      | What changed or was found, with complete, partial, or blocked status at the start.                 |
| Evidence    | Checks actually performed, observed results, and inspectable sources for material claims.          |
| Uncertainty | Unknown or untested behavior; assumptions and inferences labeled separately from verified facts.   |
| Decision    | The action requiring approval, or “No approval needed.” Name any remaining user action separately. |

Preserve existing authorization. Do not invent approval gates. Match claims to the scope of their evidence: in a Paperclip invite workflow, a valid API response establishes “invite generated,” not “owner access confirmed.” The latter needs observed acceptance and expected owner permissions. Mark those checks untested when they were not performed.

For the auto-improver's own report, a validator exit and asm score establish only those checks. They do not prove the target workflow succeeds or that its users understand the output.

## 3. Select the format by the review task

Honor the user's requested format. Otherwise use the simplest format that supports inspection:

| Task                                                                        | Format                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Quick operation                                                             | Concise text with checks and blockers.                                                                                   |
| Architecture or dependencies                                                | Diagram with a brief explanation of the relationships.                                                                   |
| Comparisons or research requiring repeated filtering or evidence inspection | HTML report with filters and expandable evidence. Use a text table when the whole comparison is easy to inspect at once. |
| Teaching a complex process                                                  | Animation or narrated explainer when requested; otherwise text or a diagram.                                             |

Keep the main result and material uncertainty visible without expansion. If tools cannot produce the chosen format, disclose the limitation and provide the content in a supported format. Preserve the output contract. Do not impose long Markdown reports or multimedia on every target.

## 4. Make complex reports interactive

For reports that need repeated filtering or evidence inspection:

- Add filters for the fields used in the user's decision.
- Place expandable evidence beside the associated claim.
- Show why each candidate or finding met or failed the criteria.
- Link to original evidence. Label missing evidence as unavailable.
- Distinguish missing values from values that fail a criterion.
- Show the visible result count and a reset control.

An AI job scout can filter salary, remote policy, and equity, with expandable company funding and product research. A code review can connect each finding to its file location, test and observed status, severity, and proposed fix. These are applications of the principles, not examples attributed to Karpathy.

Require a delivery check for every filter, expansion control, reset control, and source link. Filtering must preserve each claim's association with its evidence. Report controls or links that could not be exercised as untested. When auditing instructions alone, assess whether these checks are specified; do not claim the report controls were tested.

## 5. Evaluate understanding alongside correctness

Add these criteria to the target's evaluation guidance. If it already has eval assertions, extend them using its existing schema. Do not invent executed evals or launch a behavioral suite merely to establish an instruction-audit verdict.

| Criterion                           | Observable check                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Main result is findable             | The opening text or initial view states the result and completion status without searching logs or expanding evidence. |
| Facts and assumptions are separated | Verified claims name observed checks; assumptions, inferences, and untested behavior are labeled.                      |
| Claims are traceable                | Each material claim points to evidence supporting its scope; intermediate success does not imply final completion.     |
| Next decision is clear              | The output names the required approval, or explicitly states none is needed, and names remaining user actions.         |

Grade actual outputs against these criteria when behavioral evals are run. Include interaction assertions for interactive artifacts. Exclude negative-trigger cases, which test that the target was not applied. A heading's presence alone is not evidence of understanding.

Ask human reviewers whether they could find the result, separate facts from assumptions, trace claims, and identify the next decision. Record their answers in the existing feedback mechanism. Missing, blank, or nonresponsive feedback leaves human understanding unconfirmed. Agent inspection cannot confirm human understanding.

## Completion and loop behavior

A high asm score cannot skip these checks. Missing target requirements fail Gate 1 and enter Phase 2 even when the automated validator passes. Use the existing eight-iteration cap; count a reduction in failed target checks as Gate 1 progress. If a fix breaches the size cap, move its detail into a reference shipped with the target. Reverting a fix leaves its target check failed, not advisory.

On an early failure before inspection, report Gate 1 as unverified and explain why. Keep runtime verification separate: target instructions can pass while behavioral execution is untested and human understanding is unconfirmed. No user response is required solely to pass the instruction audit.
