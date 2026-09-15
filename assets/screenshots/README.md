# Product screenshots

These are real captures of a running local preview (web app at `http://localhost:3000`, API at `127.0.0.1:3001`), taken with synthetic requirements only: a fictional "企业 Markdown 文档协同工具" (enterprise Markdown documentation collaboration tool) workspace. No real product, customer, or account data is shown. Masked regions were redacted by the maintainer before capture was handed over.

| File | Size | Surface | Shows |
| --- | --- | --- | --- |
| `chat-dag-executors.png` | 1615 × 922 | `/chat/:workspaceId` | Planner DAG, parallel Executor cards, and the Critique Agent, each with reasoning, tool calls, token usage, and cost |
| `knowledge-graph.png` | 1920 × 922 | `/documents/:workspaceId` graph modal | 134 nodes / 161 relations, relation-type counts, node detail panel, risk and evidence groupings |
| `prd-generation.png` | 1920 × 922 | `/documents/:workspaceId` PRD modal | Draft title and version background, round-by-round scores, per-reviewer strengths/weaknesses/blockers, Markdown download |
| `knowledge-graph-full.webp` | 750 × 5592 | graph export | Complete knowledge graph rendered in one image (embedded in a collapsible README section) |

Brand art lives one level up: `../brand-hero.png` (product brand illustration) and `../logo.png` (copy of the app icon used in the README header). `brand-hero.png` is an illustration, **not** a product screenshot and **not** an architecture diagram: its agent names and PRD outline are illustrative, so the README labels it as brand art and links readers to the real UI and topology instead.

## Open items before a public announcement

1. **Private path in `chat-dag-executors.png`.** A message bubble in the left column contains a readable private test directory path (`F:\pythoncode\...`). The row is rendered in low-contrast text but is legible at full size. Re-capture or crop and replace this file, then update the README caption. Until it is replaced, the README marks the image as an illustrative workflow capture that is not production data.
2. **Legacy model IDs.** The same image and `prd-generation.png` show `deepseek-v4-flash` / `deepseek-v4-pro` in the model selector, which predates the `deepseek-flash` normalization described in the README. Re-capture against a current build so the screenshots do not contradict the documented configuration.
3. **Demo video / GIF.** `DAG初始流程_精剪强调版.mp4`, `DAG优化流程_精剪强调版.mp4`, and `生成初版文档流程_精剪强调版.mp4` exist as raw material, but no encoder was available in the preparation environment (no ffmpeg, no network). Target a 8–15 s loop, ≤3 MB, WebP or GIF first, and place it directly under the README hero. Do not commit the full-size MP4 files.
4. **Verify masking.** Re-inspect every masked region at 100% zoom before publishing, including the yellow redactions baked into the current captures.

## Rules for future captures

- Use synthetic data only. Never show real product, customer, or employee names.
- Hide API keys, provider account details, costs tied to real accounts, local absolute paths, browser account avatars, and private tabs.
- Inspect the final pixels and image metadata before committing.
- Do not label illustrations, mockups, or mocked output as validated product screenshots.
- Re-verify the README captions whenever a capture is replaced: a caption must describe what the current file actually shows.
