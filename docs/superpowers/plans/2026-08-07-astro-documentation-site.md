# Astro Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED: Use lril-superpowers:subagent-driven-development (if subagents available) or lril-superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished custom Astro landing page, expand and correct the Starlight documentation, and deploy the static site reliably under the GitHub Pages `/kanban` base path.

**Architecture:** Keep one Astro project. A custom marketing shell owns `/` and `/404.html`; Starlight continues to own every documentation route. Shared theme tokens make both surfaces coherent, while one base-path helper owns URLs in custom Astro files and relative links keep Markdown portable.

**Tech Stack:** Astro 7, Starlight 0.41, TypeScript, CSS, Markdown/MDX, Pagefind, GitHub Pages Actions.

**Design spec:** `docs/superpowers/specs/2026-08-07-astro-documentation-site-design.md`

---

## File map

### Create

- `docs-site/src/lib/site.ts` — base-path and repository URL helpers for custom Astro routes.
- `docs-site/src/layouts/MarketingLayout.astro` — metadata, skip link, page landmarks, and shared marketing shell.
- `docs-site/src/components/SiteHeader.astro` — base-aware landing/404 navigation.
- `docs-site/src/components/ProductFrame.astro` — truthful responsive angled screenshot figure.
- `docs-site/src/pages/index.astro` — bespoke landing page and approved narrative.
- `docs-site/src/pages/404.astro` — branded static GitHub Pages error route.
- `docs-site/src/styles/marketing.css` — landing and 404 layout, responsive behavior, motion fallback.
- `docs-site/src/content/docs/overview.md` — durable documentation overview moved away from the root route.
- `docs-site/src/content/docs/why-built.md` — first-person product and engineering case study.
- `docs-site/src/content/docs/agents/connect.md` — coding-agent connection guide.
- `docs-site/src/content/docs/agents/workflows.md` — practical agent operating recipes.
- `docs-site/scripts/check-links.mjs` — generated-output link and base-path validator.

### Rename

- `docs-site/src/styles/neon.css` → `docs-site/src/styles/theme.css` — accurate shared Starlight theme name after visual redesign.

### Remove

- `docs-site/src/content/docs/index.mdx` — prevents the duplicate root route; its durable content moves to `overview.md`.

### Modify

- `docs-site/astro.config.mjs` — sidebar, theme path, metadata, stable slugs.
- `docs-site/package.json` — add `check:links` and a combined `check` command.
- `docs-site/src/content/docs/features.md` — remove unqualified completeness claims.
- `docs-site/src/content/docs/getting-started.md` — clearer first run and agent next step.
- `docs-site/src/content/docs/using-the-app.md` — use the populated board screenshot and current navigation language.
- `docs-site/src/content/docs/agents/mcp.md` — complete implemented MCP surface.
- `docs-site/src/content/docs/agents/http-api.md` — reconcile with `docs/agent-api.md`.
- `docs-site/src/content/docs/guide/ai-agents.md` — safety-model opening and links to new agent docs.
- All Markdown under `docs-site/src/content/docs/` containing `/kanban/` links — convert to relative internal links.
- `.github/workflows/deploy-docs.yml` — current official Astro Pages Action versions.
- `.gitignore` — ignore `.superpowers/` visual-brainstorm artifacts.

---

## Chunk 1: Static site foundation and landing experience

### Task 1: Make root-route ownership explicit

**Files:**
- Create: `docs-site/src/content/docs/overview.md`
- Remove: `docs-site/src/content/docs/index.mdx`
- Modify: `docs-site/astro.config.mjs`

- [ ] **Step 1: Move durable overview content**

Create `overview.md` with frontmatter title `Overview`, description, the agent-native thesis, three concise capability groups, and links to Getting started, Connect a coding agent, and Why I built it. Do not copy the `132/140` claim.

- [ ] **Step 2: Remove the Starlight root producer**

Delete `src/content/docs/index.mdx`. The custom page added in Task 4 becomes the only `/` producer.

- [ ] **Step 3: Update the sidebar contract**

Replace the current sidebar with the approved Start, Use, Agents, and Build & operate groups. Use content slugs, not hard-coded `/kanban` links. Include every route from the spec’s mapping table.

- [ ] **Step 4: Run the current build to expose the intentional missing root**

Run: `npm run build` in `docs-site/`  
Expected: documentation routes build; `/` may be absent until Task 4, but there must be no duplicate-route error.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/overview.md docs-site/src/content/docs/index.mdx docs-site/astro.config.mjs
git commit -m "docs: reserve root for custom landing page"
```

### Task 2: Add base-aware shared marketing primitives

**Files:**
- Create: `docs-site/src/lib/site.ts`
- Create: `docs-site/src/layouts/MarketingLayout.astro`
- Create: `docs-site/src/components/SiteHeader.astro`

- [ ] **Step 1: Implement the single URL helper**

`site.ts` exports:

```ts
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function withBase(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}` || '/';
}

export const repositoryUrl = 'https://github.com/seanrobertwright/kanban';
```

- [ ] **Step 2: Build the header**

Use `withBase()` for Overview, Documentation, Connect an agent, and the brand home link. GitHub uses `repositoryUrl`. Keep a visible text brand, semantic `<nav aria-label="Primary">`, 44px preferred action height, and no client JavaScript.

- [ ] **Step 3: Build the layout**

`MarketingLayout.astro` imports both `theme.css` (the shared token and element layer also loaded by Starlight) and `marketing.css` (landing/404 layout only). It accepts `title` and `description`, sets canonical metadata from `Astro.site`, renders a skip link to `#main`, includes `SiteHeader`, and exposes a `<slot />` inside `<main id="main">`. This import is the only entry point for marketing styles; individual pages do not import them again.

- [ ] **Step 4: Compile through Astro**

Run: `npm run build` in `docs-site/`  
Expected: Astro compiles the new TypeScript and component imports without diagnostics. Do not use `astro check`; `@astrojs/check` is not installed in this project.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/lib/site.ts docs-site/src/layouts/MarketingLayout.astro docs-site/src/components/SiteHeader.astro
git commit -m "feat(docs): add base-aware marketing shell"
```

### Task 3: Replace the neon theme with Obsidian editorial

**Files:**
- Rename: `docs-site/src/styles/neon.css` → `docs-site/src/styles/theme.css`
- Create: `docs-site/src/styles/marketing.css`
- Modify: `docs-site/astro.config.mjs`

- [ ] **Step 1: Rename the shared theme file**

Update the Starlight `customCss` path in `astro.config.mjs`. Put the shared near-black/slate surfaces, restrained cyan accents, readable light-theme tokens, system sans/mono stacks, border colors, focus ring, code-block colors, and base element rules in `theme.css`; Starlight loads it through `customCss` and `MarketingLayout` imports it directly.

- [ ] **Step 2: Add marketing layout primitives**

In `marketing.css`, define only landing/404-specific spacing, max widths, buttons, proof cards, split sections, screenshot treatment, and the subtle grid utility. Avoid redeclaring the shared color/type tokens from `theme.css`, animation libraries, and background video.

- [ ] **Step 3: Add accessibility media queries**

At 48rem and below, stack split layouts and flatten the product frame. At 320px, prevent overflow. Under `prefers-reduced-motion: reduce`, disable transforms used only as entrance/hover effects and reduce transition durations to zero.

- [ ] **Step 4: Build the theme**

Run: `npm run build`  
Expected: Starlight routes compile with `theme.css`; no missing stylesheet.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/styles docs-site/astro.config.mjs
git commit -m "feat(docs): apply Obsidian editorial theme"
```

### Task 4: Build the custom landing page and angled screenshot

**Files:**
- Create: `docs-site/src/components/ProductFrame.astro`
- Create: `docs-site/src/pages/index.astro`
- Modify: `docs-site/src/styles/marketing.css`
- Reuse: `docs-site/src/assets/guide-board.jpg`

- [ ] **Step 1: Implement `ProductFrame`**

Import `guide-board.jpg` and Astro’s `Image`. Render a `<figure>` with an explicit descriptive `alt`, browser chrome that is `aria-hidden`, a short visible caption, explicit width/height, `loading="eager"`, and `fetchpriority="high"` (or Astro’s equivalent emitted attribute). Apply perspective only to the wrapper; do not alter the screenshot.

- [ ] **Step 2: Build the approved hero and render the product frame**

Use one `h1`: `Work has changed. The board should too.` Add the three equal base-aware links exactly as specified: Start using Kanban, Connect an agent, Read the build story. Render `<ProductFrame />` immediately after the hero copy/actions and before the coordination-problem section so the angled screenshot is part of the introduction rather than a later gallery image.

- [ ] **Step 3: Write the full landing narrative**

After `<ProductFrame />`, implement sections in this exact order: coordination problem, board-citizen thesis, research benchmark, decisions/rejections, two doors, dated implementation evidence, three documentation paths, final CTA. Use the spec’s named evidence sources. Do not present the 140-criterion benchmark as a completeness score.

- [ ] **Step 4: Add the dated evidence grid**

Re-run the count commands or equivalent repository queries before writing values. Label the block `Repository snapshot · 7 August 2026` so it cannot masquerade as a live counter.

- [ ] **Step 5: Build and visually smoke-test**

Run: `npm run build`  
Expected: `/index.html` builds from `src/pages/index.astro`; no duplicate route. Start `npm run preview` and inspect the root in a real browser at desktop and 320px.

- [ ] **Step 6: Commit**

```bash
git add docs-site/src/components/ProductFrame.astro docs-site/src/pages/index.astro docs-site/src/styles/marketing.css
git commit -m "feat(docs): build custom product landing page"
```

### Task 5: Add a branded 404 and generated-link checker

**Files:**
- Create: `docs-site/src/pages/404.astro`
- Create: `docs-site/scripts/check-links.mjs`
- Modify: `docs-site/package.json`

- [ ] **Step 1: Build `404.astro`**

Use `MarketingLayout`, one `h1`, a concise explanation, and base-aware links to home and Overview. Ensure Astro outputs `dist/404.html`.

- [ ] **Step 2: Implement link validation**

The Node script walks `dist/**/*.html` and validates local `href`, `src`, and every URL candidate in `srcset`. It ignores external/mail/data links, maps `/kanban/...` URLs back into `dist`, and fails with all missing targets. For same-page and cross-page `#fragment` links, parse the destination HTML and require a matching `id`; hash-only links are ignored only after their current page’s id is checked. It must also fail on `/kanban/kanban/` and root-absolute internal links that omit `/kanban/`.

- [ ] **Step 3: Wire package commands**

Add:

```json
"check:links": "node scripts/check-links.mjs",
"check": "npm run build && npm run check:links"
```

- [ ] **Step 4: Run the checker against the current output**

Run: `npm run check`  
Expected: the build succeeds; the checker reports every unresolved link in one run. Fix only real site links, not the checker, until it exits zero.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/pages/404.astro docs-site/scripts/check-links.mjs docs-site/package.json
git commit -m "test(docs): verify static links and 404 output"
```

---

## Chunk 2: Product narrative and operating documentation

### Task 6: Write the first-person build story

**Files:**
- Create: `docs-site/src/content/docs/why-built.md`
- Sources: `devdocs/prd.md`, `devdocs/SPEC.md`, `complete-code-review.md`, `comprehensive-uat.md`

- [ ] **Step 1: Write the problem and thesis**

Cover invisible agent work, human copy-back, planning blindness, and the coordination-layer thesis. Use first person only for decisions and reflection.

- [ ] **Step 2: Explain the research and scope tension**

Describe the 35-product/140-criterion benchmark as research input, not shipped coverage. Include the solo/part-time versus mid-market tension and why RBAC/audit became wedge dependencies.

- [ ] **Step 3: Explain and defend the architecture choices**

Cover: existing execution agents rather than a competing executor; native and external doors; shared principal/RBAC/audit behavior; narrow typed operations; blast-radius gate; why confidence thresholds and all-or-nothing autonomy were rejected; SQLite→Postgres; vertical feature slices.

- [ ] **Step 4: Include honest lessons**

Use the July code review as historical evidence: breadth created discoverability and overclaim risks; distinguish what later code fixed from what the document originally exposed. End with what the project proves today versus the remaining product ambition.

- [ ] **Step 5: Build and read the rendered page**

Run: `npm run build`  
Expected: `/why-built/index.html` renders with ordered headings and no broken citations/links.

- [ ] **Step 6: Commit**

```bash
git add docs-site/src/content/docs/why-built.md
git commit -m "docs: tell the Kanban build story"
```

### Task 7: Write coding-agent connection setup

**Files and local sources:**
- Create: `docs-site/src/content/docs/agents/connect.md`
- Modify: `docs-site/src/content/docs/getting-started.md`
- Verify against: `docs/agent-api.md`
- Verify against: `mcp/README.md`
- Verify against: `mcp/server.mjs`
- Verify against: `package.json`
- Verify against: `scripts/create-agent.mjs`

- [ ] **Step 1: Verify local prerequisites and current client syntax**

First derive Kanban’s exact commands, environment variables, key semantics, server entry point, and supported Node invocation from the five local sources above. Then use the documentation-lookup workflow and primary documentation for Claude Code, OpenAI Codex, and Cursor. Record external source links in the page. Do not let remembered client syntax override either current official docs or the repository’s actual commands.

- [ ] **Step 2: Write the canonical client-neutral sequence**

Document migrations, external agent-key creation, secret handling, starting/reaching Kanban, absolute server path or stable working directory, environment variables, and `whoami` + `list_boards` verification.

- [ ] **Step 3: Add client-specific examples**

Provide current source-verified snippets for Claude Code, Codex, Cursor, and generic stdio MCP. Every snippet uses placeholders and keeps `KANBAN_AGENT_KEY` out of version control.

- [ ] **Step 4: Add troubleshooting**

Cover `AUTH_INVALID`, wrong `KANBAN_URL`, wrong working directory, multi-board defaults, server startup diagnostics on stderr, and a successful connection transcript.

- [ ] **Step 5: Link from Getting started**

Add a next-step callout after the app first-run instructions.

- [ ] **Step 6: Build and commit**

Run: `npm run check`  
Expected: both pages build and all client/source links resolve or are recognized as external.

```bash
git add docs-site/src/content/docs/agents/connect.md docs-site/src/content/docs/getting-started.md
git commit -m "docs: add coding-agent connection guide"
```

### Task 8: Replace the thin MCP page with the implemented tool reference

**Files:**
- Modify: `docs-site/src/content/docs/agents/mcp.md`
- Source of truth: `mcp/server.mjs`
- Supporting source: `mcp/README.md`

- [ ] **Step 1: Re-extract the tool inventory**

Read registrations directly from `mcp/server.mjs`. The 2026-08-07 snapshot contains 56 tools; if the file differs, document the current file rather than preserving 56.

- [ ] **Step 2: Document every tool by workflow**

Groups: Orientation; Finding work; Changing work; Checklists/fields/time; Planning containers; Analytics/knowledge/notifications/git/change feed. Include exact names, required identifiers, mutation/read status, and critical caveats.

- [ ] **Step 3: Document shared mechanics**

Add dry runs, idempotent creates, read retries, structured errors, lease semantics, approval outcomes, pagination, `wait_for_changes`, resources, and prompts.

- [ ] **Step 4: Correct stale claims**

Remove the 11-tool table and any one-to-one parity wording that is not supported. Cross-link Connect, Workflows, HTTP API, and Agent model and safety with relative links.

- [ ] **Step 5: Build and commit**

Run: `npm run check`  
Expected: the complete reference renders and link validation passes.

```bash
git add docs-site/src/content/docs/agents/mcp.md
git commit -m "docs: document the complete MCP surface"
```

### Task 9: Add practical agent workflow recipes

**Files:**
- Create: `docs-site/src/content/docs/agents/workflows.md`
- Modify: `docs-site/src/content/docs/guide/ai-agents.md`

- [ ] **Step 1: Write six observable recipes**

Each recipe includes purpose, ordered tool calls, expected branch/error outcomes, and a copyable agent prompt:

1. Pick up and complete one task.
2. Triage without changing the board.
3. Move from task to git/PR context and report back.
4. Produce a standup from `board_analytics`.
5. Watch efficiently with `wait_for_changes`.
6. Recover from claim conflicts and held-for-review responses.

- [ ] **Step 2: Encode the invariant work loop**

Claim → history → act → comment → release. Explain when not to claim and how lease expiry changes recovery.

- [ ] **Step 3: Refocus Agent model and safety**

Open `guide/ai-agents.md` with principal/RBAC/gate concepts, retain its native-agent capabilities, and link to Connect, MCP reference, Workflows, and HTTP API.

- [ ] **Step 4: Build and commit**

Run: `npm run check`  
Expected: recipes and safety page build with no broken anchors.

```bash
git add docs-site/src/content/docs/agents/workflows.md docs-site/src/content/docs/guide/ai-agents.md
git commit -m "docs: add safe agent workflow recipes"
```

### Task 10: Reconcile the public HTTP API reference

**Files:**
- Modify: `docs-site/src/content/docs/agents/http-api.md`
- Source of truth: `docs/agent-api.md` plus current route handlers

- [ ] **Step 1: Port the current canonical mechanics**

Add agent identity, search, leases, idempotency, dry-run responses, change feed, errors, approval outcomes, and the direct HTTP work loop.

- [ ] **Step 2: Verify paths and request bodies**

Check every documented endpoint against the relevant `src/app/api/**/route.ts` and handler. Do not describe all 188 application routes as agent API routes.

- [ ] **Step 3: Add security callouts**

Explain workspace-scoped 404 behavior, viewer/member differences, key rotation by replacement, no delete/archive cut, and retryable versus non-retryable failures.

- [ ] **Step 4: Build and commit**

Run: `npm run check`  
Expected: HTTP API page renders all code blocks and link validation passes.

```bash
git add docs-site/src/content/docs/agents/http-api.md
git commit -m "docs: reconcile the agent HTTP API reference"
```

### Task 11: Fact-check the remaining user documentation and links

**Files:**
- Modify: `docs-site/src/content/docs/features.md`
- Modify: `docs-site/src/content/docs/using-the-app.md`
- Modify: `docs-site/src/content/docs/architecture.md`
- Modify: `docs-site/src/content/docs/enterprise.md`
- Modify: all content files reported by the `/kanban/` link search

- [ ] **Step 1: Remove unsupported completeness totals**

Keep the benchmark story in `features.md`, but describe capability areas without asserting every criterion is fully shipped. Link to the build story for methodology and limits.

- [ ] **Step 2: Update visual references**

Use `guide-board.jpg` for the app shell/board where the populated image is clearer. Keep truthful captions and descriptive alt text.

- [ ] **Step 3: Convert internal links**

Replace every Markdown `/kanban/...` link with a correct relative link. Re-run the search; expected result is zero hard-coded `/kanban/` content links.

- [ ] **Step 4: Fact-check architecture and operations**

Replace vague architecture counts such as `seventy-plus features` with a dated or qualitative statement. Check `enterprise.md` against current environment names, deployment topology, and implemented operator surfaces. Keep only architectural and operational invariants supported by current code.

- [ ] **Step 5: Run full static checks and commit**

Run: `npm run check`  
Expected: build and link checker pass; no duplicate-base or missing-base URLs.

```bash
git add docs-site/src/content/docs
git commit -m "docs: correct product claims and internal links"
```

---

## Chunk 3: GitHub Pages delivery and end-to-end verification

### Task 12: Update GitHub Pages deployment

**Files:**
- Modify: `.github/workflows/deploy-docs.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Apply current official Action versions**

Use `actions/checkout@v7`, `withastro/action@v6`, and `actions/deploy-pages@v5`, matching the official Astro GitHub Pages guide current on 2026-08-07. Keep `path: ./docs-site`, Pages permissions, concurrency, environment, and master/path triggers.

- [ ] **Step 2: Use a supported Node runtime**

Use the Action’s current Node 24 default or set Node 24 explicitly. Do not preserve the stale comment about the old Action’s Node 20 default.

- [ ] **Step 3: Ignore brainstorming artifacts**

Add `/.superpowers/` to the root `.gitignore`; do not remove the approved spec or plan under `docs/superpowers/`.

- [ ] **Step 4: Review the YAML and build locally**

Run: `npm run check` in `docs-site/`  
Expected: local output still matches `site=https://seanrobertwright.github.io` and `base=/kanban`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-docs.yml .gitignore
git commit -m "ci(docs): update GitHub Pages deployment"
```

### Task 13: Verify static output and representative routes

**Files:**
- Verify only; fix the owning source file if a check fails.

- [ ] **Step 1: Run the production gate**

Run: `npm run check` in `docs-site/`  
Expected: Astro build exits 0, Pagefind indexes all content, `dist/404.html` exists, and link checker exits 0.

- [ ] **Step 2: Start the built site**

Run `npm run preview -- --host 127.0.0.1` as a supervised process. Exercise `/kanban/`, `/kanban/overview/`, `/kanban/getting-started/`, `/kanban/agents/connect/`, `/kanban/agents/mcp/`, `/kanban/why-built/`, and a missing route.

- [ ] **Step 3: Verify user-visible outcomes**

Confirm the landing hero, three equal paths, angled real screenshot, long-form sections, Starlight sidebar/search, code blocks, and branded 404 all render. Confirm browser console has no errors.

- [ ] **Step 4: Verify generated paths**

Inspect resolved link targets in the browser. No request may contain `/kanban/kanban/`; no internal navigation may escape to the host root.

### Task 14: Verify accessibility and responsive behavior

**Files:**
- Verify only; fix `theme.css`, `marketing.css`, or the owning Astro/Markdown file if a check fails.

- [ ] **Step 1: Run automated DOM assertions**

On the landing page, Getting started, and Connect a coding agent, assert: one `h1`, expected landmarks, nonempty image alt text, no empty accessible links, no horizontal overflow, focusable interactive controls, and computed primary target sizes. For any interactive target smaller than 24×24 CSS pixels, measure the unobstructed spacing required by WCAG 2.2 SC 2.5.8 rather than accepting it by inspection. Repeat the landing page with reduced motion forced.

- [ ] **Step 2: Perform keyboard checks**

Use Tab/Shift+Tab/Enter/Escape. Verify skip-link behavior, header navigation, hero actions, Starlight search/sidebar controls, visible focus, and no focus obscured by sticky headers.

- [ ] **Step 3: Check responsive layouts**

At 1440px, 768px, and 320px: verify the screenshot remains legible, perspective flattens on narrow screens, navigation does not overlap, code blocks scroll internally, and the page itself has no horizontal scroll.

- [ ] **Step 4: Check contrast and motion**

Measure representative normal text, muted text, cyan links/buttons, focus rings, and borders against their actual backgrounds. Verify reduced motion removes nonessential transforms/transitions without hiding content.

- [ ] **Step 5: Verify the no-JavaScript baseline**

Disable JavaScript and reload the landing page, Overview, Getting started, and Connect a coding agent. Confirm the header links, hero actions, Starlight sidebar links, article content, code blocks, and 404 navigation remain available. Search may be unavailable as the documented progressive enhancement; missing primary navigation or content is a failure.

### Task 15: Final proof and documentation commit

**Files:**
- Modify only if verification found a real issue.
- Include: `docs/superpowers/plans/2026-08-07-astro-documentation-site.md`

- [ ] **Step 1: Re-run the complete gate after all fixes**

Run: `npm run check`  
Expected: exit 0 with successful build, Pagefind index, 404 output, and static-link validation.

- [ ] **Step 2: Repeat the browser smoke path**

Expected: all representative routes and interactions from Tasks 13–14 pass with no console errors.

- [ ] **Step 3: Commit the plan and any final corrections**

```bash
git add docs/superpowers/plans/2026-08-07-astro-documentation-site.md docs-site
git commit -m "docs: finalize Astro documentation site"
```

- [ ] **Step 4: Report exact evidence**

Report changed routes, build/check output, browser routes exercised, viewport sizes, keyboard flows, reduced-motion result, and any intentionally retained limitations. Do not claim a live GitHub Pages deployment until the workflow actually runs on GitHub.
