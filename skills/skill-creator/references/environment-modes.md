# Environment-Specific Notes

The core workflow (draft → test → review → improve → repeat) is the same everywhere, but a few mechanics change based on the environment you're in. Read the section that applies.

## Claude.ai

Claude.ai doesn't have subagents, so parts of the flow have to be done serially or skipped.

**Adversarial review without subagents**: No Agent tool means no fresh reviewer context. Copy the phase 1–3 prompts from `references/validation-prompts.md` into a separate, fresh Claude session (a new conversation that hasn't seen the draft), then paste its findings back and fix the real ones. If a truly fresh session isn't possible, run the phases yourself and treat the results as a weaker self-review — you wrote the draft, so you'll fill gaps from memory. Compensate by holding the line on the eval floor (≥3 happy-path, ≥1 edge, ≥1 negative-trigger) and the human review step.

**Running test cases**: No subagents means no parallel execution. For each test case, read the skill's SKILL.md, then follow its instructions to accomplish the test prompt yourself. Do them one at a time. This is less rigorous than independent subagents (you wrote the skill and you're also running it, so you have full context), but it's a useful sanity check — and the human review step compensates. Skip the baseline runs — just use the skill to complete the task as requested.

**Reviewing results**: If you can't open a browser (e.g., Claude.ai's VM has no display, or you're on a remote server), skip the browser reviewer entirely. Instead, present results directly in the conversation. For each test case, show the prompt and the output. If the output is a file the user needs to see (like a .docx or .xlsx), save it to the filesystem and tell them where it is so they can download and inspect it. Ask for feedback inline: "How does this look? Anything you'd change?"

**Benchmarking**: Skip the quantitative benchmarking — it relies on baseline comparisons which aren't meaningful without subagents. Focus on qualitative feedback from the user.

**The iteration loop**: Same as before — improve the skill, rerun the test cases, ask for feedback — just without the browser reviewer in the middle. You can still organize results into iteration directories on the filesystem if you have one.

**Description optimization**: `run_loop.py` needs the `claude` CLI (`claude -p`, available only in Claude Code) for its trigger tests and the `anthropic` Python SDK with API credentials for its improvement step. Skip it if you're on Claude.ai.

**Blind comparison**: Requires subagents. Skip it.

**Packaging**: The `package_skill.py` script works anywhere with Python and a filesystem. On Claude.ai, you can run it and the user can download the resulting `.skill` file.

## Cowork

Cowork has subagents but no browser, so test execution works but result viewing has to go through static HTML.

- You have subagents, so the main workflow (spawn test cases in parallel, run baselines, grade, etc.) all works. (However, if you run into severe problems with timeouts, it's OK to run the test prompts in series rather than parallel.)
- You don't have a browser or display, so when generating the eval viewer, use `--static <output_path>` to write a standalone HTML file instead of starting a server. Then proffer a link that the user can click to open the HTML in their browser.
- After running tests, generate the eval viewer with `generate_review.py` (not custom HTML) before you evaluate the outputs or revise the skill yourself — in Cowork as in Claude Code — so the human sees the examples first.
- Feedback works differently: since there's no running server, the viewer's "Submit All Reviews" button will download `feedback.json` as a file. You can then read it from there (you may have to request access first).
- Packaging works — `package_skill.py` just needs Python and a filesystem.
- Description optimization (`run_loop.py` / `run_eval.py`) needs no browser, so it runs in Cowork when `claude -p` and Anthropic API credentials are available — save it until you've fully finished making the skill and the user agrees it's in good shape.
