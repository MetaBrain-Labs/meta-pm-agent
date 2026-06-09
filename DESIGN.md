---
name: meta-pm-agent
description: AI-powered project management chat agent
colors:
  bg-deep: "#0f1117"
  bg-elevated: "#161b22"
  bg-surface: "#0d1117"
  bg-agent: "#21262d"
  accent-primary: "#1f6feb"
  accent-primary-hover: "#388bfd"
  accent-primary-muted: "#0d1f3c"
  accent-green: "#3fb950"
  accent-green-dark: "#238636"
  accent-green-muted: "#1a3a2a"
  accent-link: "#58a6ff"
  accent-warning: "#f0883e"
  accent-danger: "#f85149"
  accent-code: "#d2a8ff"
  text-primary: "#e1e4e8"
  text-secondary: "#c9d1d9"
  text-muted: "#8b949e"
  text-subtle: "#484f58"
  border-default: "#30363d"
  border-subtle: "#21262d"
  white: "#ffffff"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "SF Mono, Fira Code, Fira Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "20px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-primary-hover}"
  button-danger:
    backgroundColor: "{colors.accent-danger}"
  button-disabled:
    backgroundColor: "{colors.bg-agent}"
    textColor: "{colors.text-muted}"
  input-textarea:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  input-focus:
    borderColor: "{colors.accent-primary}"
  agent-bubble:
    backgroundColor: "{colors.bg-agent}"
    rounded: "{rounded.xl}"
  user-bubble:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.xl}"
  chip-default:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
  chip-selected:
    backgroundColor: "{colors.accent-primary-muted}"
    textColor: "{colors.accent-link}"
    rounded: "{rounded.md}"
  card-container:
    backgroundColor: "{colors.bg-elevated}"
    rounded: "{rounded.xl}"
  todo-card:
    rounded: "{rounded.lg}"
  thinking-box:
    backgroundColor: "{colors.bg-elevated}"
    rounded: "{rounded.md}"
---

# Design System: meta-pm-agent

## 1. Overview

**Creative North Star: "The Focused Workspace"**

A quiet, dark-mode tool interface where the conversation is the interface. Every pixel serves the user's train of thought; nothing competes for attention. The palette is restrained GitHub-dark with a single blue accent that signals interactivity without shouting. Surfaces are layered through tonal contrast rather than shadows — like stacked sheets of paper on a desk under dim warm light.

**Key Characteristics:**
- Dark-first, conversation-centric layout
- Single accent (blue) carries all interactive meaning
- Tonal layering for depth (three neutral bg levels: deep / elevated / surface)
- Monospace reserved for code and system messages; everything else in system sans-serif
- Corners are softly rounded (4–12px range) — professional, not soft

**Anti-references:** The system rejects SaaS-template card grids, decorative gradients, glassmorphism, and any visual element that draws attention away from the conversation. This is a tool, not a brochure.

## 2. Colors

The palette is a dark neutral core with one blue accent and semantic signal colors (green for success, orange for tools, red for errors, purple for code).

### Primary
- **Accent Blue** (#1f6feb): Buttons, links, focus rings, selected states. The only interactive color. Used on ≤10% of the surface.
- **Accent Blue Hover** (#388bfd): Hover state for primary buttons and interactive elements.
- **Accent Blue Muted** (#0d1f3c): Background for selected chips and active sidebar items.

### Secondary
- **Signal Green** (#3fb950): Status dot, completed todos, submit button gradient end. Success affirmation.
- **Signal Green Dark** (#238636): Submit button gradient start, locked form indicators.

### Tertiary
- **Tool Orange** (#f0883e): Tool call badges. Signals "the agent is doing something."
- **Danger Red** (#f85149): Error states, required field markers.
- **Code Purple** (#d2a8ff): Inline code and code block content.

### Neutral
- **Deep Surface** (#0f1117): Body background. The deepest layer.
- **Elevated Surface** (#161b22): Header bar, input area, thinking box. Slightly lifted.
- **Surface** (#0d1117): Textarea, sidebar, form footer. Between deep and elevated.
- **Agent Bubble** (#21262d): AI message background. Distinct from user bubbles.
- **Primary Text** (#e1e4e8): Body copy, headings.
- **Secondary Text** (#c9d1d9): Supporting prose, form labels.
- **Muted Text** (#8b949e): Placeholders, timestamps, collapsed sections.
- **Subtle Text** (#484f58): Extremely muted; empty states, sidebar dates, disabled content.
- **Border** (#30363d): Default border for cards, inputs, dividers.
- **Border Subtle** (#21262d): Section dividers, inner borders.

### Named Rules

**The One Accent Rule.** Blue (#1f6feb) is the only interactive accent. No other color indicates "clickable." Its rarity on the surface is intentional — when everything is blue, nothing is.

**The Tonal-Not-Shadow Rule.** Depth is conveyed through three background levels (deep / elevated / surface), not drop shadows. If a layer needs separation, it gets a 1px `border-subtle` border, never a box-shadow.

## 3. Typography

**Body Font:** -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
**Mono Font:** "SF Mono", "Fira Code", "Fira Mono", monospace

**Character:** Clean system sans-serif for readability in extended chat sessions. Monospace is reserved for code blocks, system reminders, and technical output. No decorative or display fonts — this is a workspace, not a magazine.

### Hierarchy
- **Heading 1** (700, 20px, 1.3): Prose section titles, bordered at bottom with `border-subtle`
- **Heading 2** (600, 17px, 1.3): Sub-section titles within agent responses
- **Heading 3** (600, 15px, 1.3): Minor section heads, same color as body
- **Body** (400, 14px, 1.5): Conversation text, form descriptions. Capped at message-bubble width (~85% of container, roughly 65–75ch).
- **Small/Label** (400–600, 11–13px, variable): Timestamps, metadata, form hints, chip labels. Muted colors only.
- **Code** (400, 12px, 1.55): Inline in prose or in pre blocks. Purple accent.

### Named Rules

**The Mono Boundary Rule.** Monospace is for code, system prompts, and technical artifacts — never for UI labels or body copy. If it looks like a terminal in the middle of a chat bubble, it's a code block.

**The One-Hierarchy Rule.** Chat messages use one text size (14px). Hierarchy within agent responses comes from markdown headings, not from font-size stacking. The message is the message; the heading is its structure.

## 4. Elevation

This system is **flat by default**. No drop shadows on cards, bubbles, or inputs. Depth is achieved through tonal layering: three background levels (deep → elevated → surface) create a subtle foreground/background relationship. The only non-flat element is the scroll-to-bottom button, which carries a minimal shadow (`0 2px 8px rgba(0,0,0,0.4)`) to float above the chat stream.

### Named Rules

**The Flat-By-Default Rule.** No box-shadow on any static element. Shadows appear only as a response to state (e.g., hover glow on focus rings via `box-shadow: 0 0 0 3px rgba(31,111,235,0.15)`).

## 5. Components

### Buttons
- **Shape:** Rounded 8px. No pill shapes for primary actions.
- **Primary:** `{colors.accent-primary}` background, `{colors.white}` text, 10px 20px padding. Weight 600.
- **Hover:** `{colors.accent-primary-hover}` background transition (0.15s ease).
- **Disabled:** `{colors.bg-agent}` background, `{colors.text-muted}` text, `cursor: not-allowed`.
- **Danger / Ghost:** Variants exist for clear/error contexts; follow same shape rules.

### Chat Bubbles
- **Shape:** 12px radius all corners except the bottom corresponding to the sender side: user bubbles flatten to 4px at bottom-right; agent bubbles flatten to 4px at bottom-left.
- **User Bubble:** `{colors.accent-primary}` background, `{colors.white}` text. Max-width 85%.
- **Agent Bubble:** `{colors.bg-agent}` background, 1px `{colors.border-default}` border. Max-width 85%.

### Input / Textarea
- **Style:** `{colors.bg-surface}` background, 1px `{colors.border-default}` border, 8px radius, 10px 14px padding.
- **Focus:** Border shifts to `{colors.accent-primary}`. Adds `0 0 0 3px rgba(31,111,235,0.15)` glow ring.
- **Placeholder:** `{colors.text-subtle}`, 14px, no italic.
- **Disabled:** Opacity 0.6.

### Chips / Pills
- **Default:** `{colors.bg-surface}` bg, 1px `{colors.border-default}` border, `{colors.text-muted}` text, 8px radius.
- **Hover:** Border shifts to `{colors.accent-primary}`, text elevates to `{colors.text-secondary}`.
- **Selected:** `{colors.accent-primary-muted}` bg, `{colors.accent-link}` text, `{colors.accent-primary}` border.
- **Disabled:** Opacity 0.35, `cursor: not-allowed`.

### Question Form
- **Container:** 12px radius, subtle gradient from `{colors.bg-elevated}` → `{colors.bg-surface}`, 1px `{colors.border-default}` border. Single `0 2px 12px rgba(0,0,0,0.25)` shadow — the deliberate exception to the flat rule.
- **Header:** `{colors.bg-elevated}` bg with icon + title + locked/complete badge.
- **Footer:** `{colors.bg-surface}` bg with hint text and submit button.

### Todo Card
- **Shape:** 10px radius, 1px `{colors.border-default}` border, `{colors.bg-elevated}` bg.
- **Items:** Each row has a status indicator (circle, 18px): pending (empty, `{colors.border-default}` border), in-progress (blue, pulsing glow), completed (green, filled). Active items get `{colors.accent-link}` text weight 500.

### Thinking Box
- **Shape:** 8px radius, `{colors.bg-elevated}` bg, 1px `{colors.border-default}` border. Collapsible.
- **Header:** `{colors.text-muted}`, cursor pointer, chevron rotates on open.
- **Content:** `{colors.text-muted}` monospace text, max-height 300px scrollable.

## 6. Do's and Don'ts

### Do:
- **Do** use the three bg levels (deep / elevated / surface) to convey depth through tone, not shadow.
- **Do** keep the conversation as the primary visual element. Chrome (header, input) is minimal and recessive.
- **Do** use `{colors.accent-primary}` blue only for interactive elements — buttons, links, focus, selected states.
- **Do** signal agent thinking with the collapsing Thinking Box; never show raw streaming text.
- **Do** cap message bubbles at 85% width for comfortable reading line length.
- **Do** use the question-form box-shadow as the deliberate exception that makes the form feel "in play."

### Don't:
- **Don't** use gradient text or `background-clip: text` anywhere. Solid colors only.
- **Don't** add drop shadows to bubbles, cards, or inputs. Flat tonal layering carries depth.
- **Don't** introduce a second accent color for interactive states. Blue owns all interactivity.
- **Don't** use border-left or border-right greater than 1px as colored accents on cards or callouts.
- **Don't** use glassmorphism or backdrop-filter blur — this is a workspace, not a glass pane.
- **Don't** add any visual element that distracts from the conversation flow. If a design element calls attention to itself, it's wrong.
