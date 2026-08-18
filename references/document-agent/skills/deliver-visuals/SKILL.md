---
name: deliver-visuals
description: Add grounded ECharts charts, prototype wireframes, and static HTML previews to a PRD when the supplied product knowledge graph supports them. Use when drafting or revising PRD visualizations.
license: Apache-2.0
---

# Deliver PRD Visualizations

Use visual fenced blocks only when they reduce reader effort. Keep the full
prose requirement, table, story, and acceptance criteria around every visual.
A visual block is optional support, never a replacement for grounded text.

## Grounding Rules

1. Derive every visual value from the supplied graph payload. Never invent
   metrics, baselines, targets, priorities, screen copy, or interaction detail.
2. If a value is missing, do not draw it. Write `TBD` in the surrounding prose
   or table instead.
3. Preserve source-node traceability in nearby text, exactly like normal PRD
   claims. Do not cite unknown graph IDs.
4. Mark uncertain layouts and flows as `Assumption` in the visual title or
   nearby prose.
5. Place each visual directly after the section it supports, never before the
   PRD title.
6. Use at most a small number of visuals (typically 2-4) for the whole PRD.
   Prefer one chart for priority/scope, one chart for metrics when numeric
   evidence exists, and one prototype only for the highest-value interface flow.
7. Every fenced block must contain only the exact JSON or HTML body. No nested
   fences, no trailing prose inside the fence, no comments, and no JavaScript.

## ECharts Blocks

Use a fenced `echarts` block containing one valid ECharts option JSON object.
The frontend renders it as a 360px canvas chart.

Rules:

- Use only quantitative facts already present in the graph.
- Prefer simple readable series: `bar`, `line`, `pie`, `scatter`, `radar`,
  `gauge`, or `funnel`.
- Include `title`, `tooltip`, `legend`, and axis labels when they improve
  readability.
- Do not use functions, callbacks, `graphic` scripted animations, or options
  that require custom JavaScript.
- Keep the JSON compact so the PRD remains readable.

Example:

```echarts
{
  "title": { "text": "Requirement count by priority" },
  "tooltip": { "trigger": "axis" },
  "xAxis": { "type": "category", "data": ["P0", "P1", "P2"] },
  "yAxis": { "type": "value", "name": "Requirements" },
  "series": [
    { "name": "Requirements", "type": "bar", "data": [4, 7, 3] }
  ]
}
```

## Prototype Blocks

Use a fenced `prototype` block for a static, graph-grounded wireframe. The root
must be one JSON object with these fields:

- `title`: short screen or flow name.
- `description`: one sentence of context, including `Assumption` when needed.
- `layout`: `"mobile"` or `"desktop"` (default is desktop).
- `blocks`: ordered array of block objects.

Supported block types:

| type | Required/optional fields |
| --- | --- |
| `header` | `text`, optional `subtitle`, `description` |
| `text` | `text`, optional `level` = `title` \| `body` \| `caption` |
| `button` | `text`, optional `variant` = `primary` \| `default` \| `danger` \| `link`, `block` |
| `input` | `label`, optional `placeholder` |
| `select` | `label`, optional `placeholder`, `options` |
| `checkbox` | `text`, optional `checked` |
| `list` | `items` (string array) |
| `table` | `columns` (string array), `rows` (array of string arrays), optional `title` |
| `alert` | `text`, optional `tone` = `info` \| `success` \| `warning` \| `error`, `description` |
| `card` | `title`, optional `blocks` |
| `tabs` | `tabs` = array of `{ "label": "...", "blocks": [...] }` |
| `divider` | `text` |
| `steps` | `steps` (string array), optional `current` |
| `stat` | `label`, `value`, optional `suffix` |

Example:

```prototype
{
  "title": "Mobile login screen",
  "description": "Static wireframe for the evidence-backed phone login flow.",
  "layout": "mobile",
  "blocks": [
    { "type": "header", "text": "Sign in" },
    { "type": "text", "text": "Use the phone number verified during onboarding.", "level": "caption" },
    { "type": "input", "label": "Phone number", "placeholder": "Enter phone number" },
    { "type": "input", "label": "Verification code", "placeholder": "6-digit code" },
    { "type": "button", "text": "Send code", "variant": "default" },
    { "type": "button", "text": "Sign in", "variant": "primary", "block": true },
    { "type": "alert", "tone": "info", "text": "First sign-in creates the account automatically." }
  ]
}
```

## Static HTML Blocks

Use a fenced `html` block only when the `prototype` DSL cannot express a
complex static layout. The preview iframe disables scripts, forms, and
same-origin access.

Rules:

- Emit only static HTML with inline styles or simple utility classes.
- Do not include `<script>`, external stylesheets, external images, fonts,
  forms, `javascript:` links, or any external resource.
- Keep the fragment below roughly 120 lines.

Example:

```html
<div style="font-family: sans-serif; max-width: 360px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px;">
  <h3 style="margin: 0 0 8px;">Sign in</h3>
  <p style="color: #6b7280; font-size: 12px; margin: 0 0 12px;">Static wireframe preview</p>
  <input readonly placeholder="Phone number" style="width: 100%; margin-bottom: 8px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px;" />
  <button style="width: 100%; padding: 8px; border: none; border-radius: 8px; background: #1677ff; color: white;">Sign in</button>
</div>
```
