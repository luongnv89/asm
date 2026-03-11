# Brand Kit — skill-manager

## Logo

The skill-manager logo features **three orbital paths converging on a central hub node**. The orbits represent multiple AI agent skills flowing through a unified management layer. Smaller nodes along the paths represent individual agents (Claude Code, Codex, OpenClaw, etc.) while the central filled circle is the manager — the orchestration point. The design uses layered opacity for visual depth and a neon green palette that matches the [luongnv.com](https://luongnv.com) brand identity.

### Logo Files

| File                            | Usage                                                   |
| ------------------------------- | ------------------------------------------------------- |
| `assets/logo/logo-full.svg`     | Primary logo — mark + wordmark (horizontal layout)      |
| `assets/logo/logo-mark.svg`     | Symbol/icon only — for compact spaces                   |
| `assets/logo/logo-wordmark.svg` | Text only — when mark is shown separately               |
| `assets/logo/logo-icon.svg`     | App icon — square with rounded corners, dark background |
| `assets/logo/favicon.svg`       | Favicon — optimized for 16x16                           |
| `assets/logo/logo-white.svg`    | Full logo in white — for dark backgrounds               |
| `assets/logo/logo-black.svg`    | Full logo in black — for light backgrounds              |

### Usage Guidelines

- **Minimum size**: The mark should not be rendered smaller than 16x16px
- **Clear space**: Maintain at least 25% of the mark's width as padding around it
- **Do not** rotate, distort, recolor, or add effects to the logo
- **Dark backgrounds**: Use `logo-full.svg` (default, designed for dark) or `logo-white.svg`
- **Light backgrounds**: Use `logo-black.svg`
- **Monochrome contexts**: Use `logo-black.svg` or `logo-white.svg`
- **Colored on dark**: The primary `logo-full.svg` renders neon green on transparent — ideal over `#0a0a0a` backgrounds

## Colors

Derived from the [luongnv.com](https://luongnv.com) design system.

### Dark Mode (primary)

| Role                 | Hex                   | Name          | Usage                             |
| -------------------- | --------------------- | ------------- | --------------------------------- |
| Accent               | `#00ff41`             | Neon Green    | Brand mark, primary accents, CTAs |
| Accent Hover         | `#00cc33`             | Deep Green    | Hover states, secondary nodes     |
| Accent Glow          | `rgba(0,255,65,0.15)` | Green Glow    | Subtle glow effects               |
| Background Primary   | `#0a0a0a`             | Near-Black    | Primary backgrounds               |
| Background Secondary | `#111111`             | Dark Gray     | Cards, secondary surfaces         |
| Background Tertiary  | `#1a1a1a`             | Charcoal      | Tertiary surfaces, borders        |
| Text Primary         | `#fafafa`             | Off-White     | Headings, body text               |
| Text Secondary       | `#a1a1a1`             | Light Gray    | Secondary text                    |
| Text Muted           | `#737373`             | Muted Gray    | Placeholder, muted content        |
| Border               | `#262626`             | Dark Border   | Borders, dividers                 |
| Border Hover         | `#404040`             | Medium Border | Hover borders                     |

### Light Mode

| Role                 | Hex                   | Name         | Usage                       |
| -------------------- | --------------------- | ------------ | --------------------------- |
| Accent               | `#059033`             | Forest Green | Brand mark, primary accents |
| Accent Hover         | `#047528`             | Dark Green   | Hover states                |
| Accent Glow          | `rgba(5,144,51,0.12)` | Green Glow   | Subtle glow effects         |
| Background Primary   | `#f5f5f5`             | Light Gray   | Primary backgrounds         |
| Background Secondary | `#ebebeb`             | Mid Gray     | Cards, secondary surfaces   |
| Text Primary         | `#111111`             | Near-Black   | Headings, body text         |

### Tailwind Config

```js
colors: {
  brand: {
    accent: '#00ff41',
    'accent-hover': '#00cc33',
    'accent-light': '#059033',
    dark: '#0a0a0a',
    'dark-secondary': '#111111',
    'dark-tertiary': '#1a1a1a',
  }
}
```

### System Status Colors (UI only)

| Role    | Hex       | Usage                             |
| ------- | --------- | --------------------------------- |
| Danger  | `#EF4444` | Error states, destructive actions |
| Warning | `#F59E0B` | Warnings, caution indicators      |
| Info    | `#3B82F6` | Informational highlights          |

These are for text elements only — never for backgrounds or primary UI.

## Typography

- **Primary font**: Inter (Bold for headings, Medium for body)
- **Monospace**: JetBrains Mono, Fira Code (code blocks, terminal UI)
- **Fallback stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Wordmark split**: "skill-" in Off-White (`#fafafa`), "manager" in Neon Green (`#00ff41`) — no space, hyphen connects them

## Tone

- Developer-focused, technical, sharp
- Dark-first aesthetic with neon green energy
- Consistent with the [luongnv.com](https://luongnv.com) personal brand
