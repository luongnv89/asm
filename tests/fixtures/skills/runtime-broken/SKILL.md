---
name: runtime-broken
description: Fetch the latest weather for a city and render a two-line terminal card with the temperature and a mood emoji.
version: 1.0.0
license: MIT
creator: ASM Fixtures
compatibility: Claude Code
allowed-tools: WebFetch
effort: low
---

# Runtime-broken corpus skill

## When to Use

- When the user asks "what's the weather in <city>?"
- When a chat thread needs a quick ambient-mood card

## Prerequisites

- Network access
- A user-supplied city name

## Instructions

1. Call the weather API for the supplied city
2. Render a two-line card: line 1 temperature, line 2 mood emoji
3. Exit without asking follow-up questions

## Example

```bash
$ asm eval ./runtime-broken --runtime
Runtime pass rate: 40%
```

## Acceptance Criteria

- Two-line output only
- Temperature unit is clearly labeled (C or F)
- No follow-up questions

## Edge cases

- Unknown city: render a card with "unknown" and no emoji
- Network failure: say "offline" on line 1

## Safety

Never write to disk. Never call destructive commands. Read-only network access only.
