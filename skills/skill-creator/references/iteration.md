# Improving the Skill

This is the heart of the loop. You've run the test cases, the user has reviewed the results, and now you need to make the skill better based on their feedback.

## Start with the misfire log

Before anything else, check `evals/misfires.jsonl` in the skill directory (schema in `references/schemas.md`). Each line is a failure a real user already hit — strictly better signal than any synthetic test case. Convert misfires into eval cases and let them drive this iteration's priorities; a skill that fixes its logged misfires improves where it actually hurts, not where the author guessed. If the file is missing or empty, proceed on user feedback alone — and remember to append to it whenever a misfire surfaces during your own sessions.

## How to think about improvements

1. **Generalize from the feedback.** The big picture thing that's happening here is that we're trying to create skills that can be used a million times (maybe literally, maybe even more who knows) across many different prompts. Here you and the user are iterating on only a few examples over and over again because it helps move faster. The user knows these examples in and out and it's quick for them to assess new outputs. But if the skill you and the user are codeveloping works only for those examples, it's useless. Rather than put in fiddly overfitty changes, or oppressively constrictive MUSTs, if there's some stubborn issue, you might try branching out and using different metaphors, or recommending different patterns of working. It's relatively cheap to try and maybe you'll land on something great.

2. **Keep the prompt lean.** Remove things that aren't pulling their weight. Make sure to read the transcripts, not just the final outputs — if it looks like the skill is making the model waste a bunch of time doing things that are unproductive, you can try getting rid of the parts of the skill that are making it do that and seeing what happens.

3. **Explain the why.** Try hard to explain the **why** behind everything you're asking the model to do. Today's LLMs are _smart_. They have good theory of mind and when given a good harness can go beyond rote instructions and really make things happen. Even if the feedback from the user is terse or frustrated, try to actually understand the task and why the user is writing what they wrote, and what they actually wrote, and then transmit this understanding into the instructions. If you find yourself writing ALWAYS or NEVER in all caps, or using super rigid structures, that's a yellow flag — if possible, reframe and explain the reasoning so that the model understands why the thing you're asking for is important. That's a more humane, powerful, and effective approach.

4. **Look for repeated work across test cases.** Read the transcripts from the test runs and notice if the subagents all independently wrote similar helper scripts or took the same multi-step approach to something. If all 3 test cases resulted in the subagent writing a `create_docx.py` or a `build_chart.py`, that's a strong signal the skill should bundle that script. Write it once, put it in `scripts/`, and tell the skill to use it. This saves every future invocation from reinventing the wheel.

5. **Consider restructuring to use subagents.** When reviewing an existing skill (or after test runs reveal problems), look for signs that the skill would benefit from a subagent architecture. Read the transcripts and watch for these red flags:
   - **Context bloat:** The main agent reads 10+ files, fills its context with source code, and then struggles to produce quality output because it's juggling too much.
   - **Sequential bottlenecks:** The skill does A, then B, then C, but A and B are independent — they could run in parallel as subagents.
   - **Self-review blindness:** The skill generates output and then reviews its own work, but the review is shallow because the agent is already biased by having created it.
   - **Repeated heavy lifting:** Each invocation re-does expensive exploration (scanning the codebase, reading docs) that could be isolated in a subagent.
   - **Monolithic SKILL.md:** The skill file is 400+ lines because it contains detailed instructions for every phase — a sign that phases should be split into subagent prompt files in `agents/`.

   If you spot these patterns, suggest restructuring the skill to use the orchestrator pattern: the main agent coordinates and communicates with the user, while subagents handle exploration, execution, and review in isolated context. This makes the skill faster (parallel work), more reliable (fresh context per task), and easier to maintain (each subagent prompt is focused).

   Read `references/subagent-patterns.md` for the full catalog of patterns (Explorer+Executor, Parallel Workers, Review Loop, Research+Synthesis, Staged Pipeline) and guidance on writing subagent prompts and handling graceful degradation.

Write a draft revision, then reread it fresh and improve it before rerunning, keeping in view what the user actually wants and needs.

## The iteration loop

After improving the skill:

1. Apply your improvements to the skill
2. Rerun all test cases into a new `iteration-<N+1>/` directory, including baseline runs. If you're creating a new skill, the baseline is always `without_skill` (no skill) — that stays the same across iterations. If you're improving an existing skill, use your judgment on what makes sense as the baseline: the original version the user came in with, or the previous iteration.
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user to review and tell you they're done
5. Read the new feedback, improve again, repeat

Keep going until:

- The user says they're happy
- The feedback is all empty (everything looks good)
- You're not making meaningful progress

## Advanced: Blind comparison

For situations where you want a more rigorous comparison between two versions of a skill (e.g., the user asks "is the new version actually better?"), there's a blind comparison system. Read `agents/comparator.md` and `agents/analyzer.md` for the details. The basic idea is: give two outputs to an independent agent without telling it which is which, and let it judge quality. Then analyze why the winner won.

This is optional, requires subagents, and most users won't need it. The human review loop is usually sufficient.
