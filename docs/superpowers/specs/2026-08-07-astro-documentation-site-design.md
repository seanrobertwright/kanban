# Astro documentation site design

**Date:** 2026-08-07  
**Status:** Approved  
**Target:** GitHub Pages at `https://seanrobertwright.github.io/kanban/`

## Objective

Turn the existing Astro/Starlight documentation project into a professional product and engineering site with two distinct jobs:

1. Explain why Kanban exists, what was considered, and how the implementation reflects those decisions.
2. Help people operate the application and connect their existing coding agents through MCP or HTTP.

The site must remain static, fast, accessible, and safe to publish from GitHub Actions.

## Grounded baseline

Evidence snapshot taken on 2026-08-07:

| Claim | Evidence |
|---|---|
| 42 vertical feature slices | Count directories under `src/features/`. |
| 188 Next.js API routes | Count `src/app/api/**/route.ts`. |
| 88 Postgres migrations | Count `src/shared/db/migrations/*.sql`. |
| 153 TypeScript test files | Count `src/**/*.test.ts` and `src/**/*.test.tsx`. |
| 56 registered MCP tools, plus resources and prompts | Parse the top-level `tool`, `mutating`, and `field` registrations in `mcp/server.mjs`; that file is authoritative. |
| 19 existing Starlight pages and 2,827 lines | Count `.md` and `.mdx` files and their lines under `docs-site/src/content/docs/`. |
| Production documentation build passes | Observed locally on 2026-08-07 with `npm run build` in `docs-site/`; the build produced 20 pages and a Pagefind index. |
| Product intent and agent model | `devdocs/prd.md`, especially §§1, 4, and 7. |
| Current user-visible behavior | `comprehensive-uat.md` v1.1; code remains authoritative when it conflicts. |
| Known implementation gaps and prior audit findings | `complete-code-review.md` dated 2026-07-25; use as historical context, not current-state truth where later code differs. |

The existing site is a sound documentation base, but its root page is still a stock Starlight splash. Several public facts have drifted: the Starlight MCP page documents only 11 tools, `mcp/README.md` claims 49, and the implementation registers 56. The landing page also repeats an unqualified `132/140` completeness claim that conflicts with the repository’s own historical audit. The implementation must regenerate or re-check every dated count above rather than copying it blindly.

## Audience and voice

The site gives equal priority to three readers:

- A user learning the application.
- A developer connecting a coding agent.
- A reviewer interested in the product and engineering decisions.

The voice is a balanced hybrid:

- Product-led for the hero and capability explanations.
- First-person for the build story and design tradeoffs.
- Reference-oriented in procedural and API documentation.

Claims about current behavior must be grounded in current code, with `comprehensive-uat.md` used as the named user-flow reference. Aspirational product decisions are labeled as original intent rather than shipped behavior.

## Chosen architecture

Use a custom Astro landing page and keep Starlight for documentation.

- `/kanban/` has exactly one producer: a bespoke `src/pages/index.astro` route without a documentation sidebar.
- The current `src/content/docs/index.mdx` is removed. Its durable overview content is rewritten at `src/content/docs/overview.md` (`/kanban/overview/`); the old root URL intentionally becomes the landing page, so no redirect is created.
- Every other existing Starlight content route remains stable.
- Starlight continues to provide search, sidebar navigation, table of contents, responsive behavior, semantic content structure, and accessible defaults.
- The landing page and documentation share one visual token system and one global stylesheet.
- In `.astro` files and shared components, one `withBase()` helper built from `import.meta.env.BASE_URL` produces internal URLs. Markdown and MDX use relative internal links. Content images use relative imports from `src/assets`. Starlight generates canonical URLs from `site` and `base`. Hard-coded root-absolute internal links are not introduced.

Rejected alternatives:

1. **Customized Starlight splash only:** lower effort, but insufficient control for the long-form narrative, three-path hero, and angled product frame.
2. **Fully custom Astro documentation:** maximum control, but needlessly rebuilds search, navigation, mobile behavior, and accessibility that Starlight already solves.

## Information architecture

### Landing page

The landing page follows this sequence:

1. **Hero:** “Work has changed. The board should too.” Three visually equal, base-aware internal calls to action: **Start using Kanban** → `/getting-started/` (setup documentation, not a live demo), **Connect an agent** → `/agents/connect/`, and **Read the build story** → `/why-built/`. Each accessible name matches its visible label.
2. **Product image:** a real board screenshot in an angled, restrained browser frame.
3. **Problem:** agent work is invisible to human-first trackers and has to be copied back manually.
4. **Thesis:** the board is a neutral coordination layer; agents are principals and board citizens, not an AI sidebar.
5. **Research:** the product was informed by a 35-product, 140-criterion task-management benchmark.
6. **Decisions and rejected alternatives:** coordinate existing execution agents instead of competing with them; use two thin doors over shared server behavior; gate by blast radius rather than model confidence; use narrow typed operations instead of one general API tool.
7. **Two doors:** native board agents and external agents using MCP/HTTP, with identity, permissions, leases, audit, and review gates shared across both.
8. **Implementation evidence:** a dated snapshot of current repository scale and architecture, presented as evidence rather than marketing totals.
9. **Documentation paths:** Start using Kanban, Connect an agent, Understand the build.
10. **Final call to action:** **Read the documentation** → `/overview/` and **View source on GitHub** → `https://github.com/seanrobertwright/kanban`.

### Documentation navigation

- **Start**
  - Overview
  - Feature map
  - Getting started
  - Using the app
- **Use**
  - Work items
  - Planning and views
  - Agile workflows
  - Automations
  - Automation cookbook
  - Collaboration and knowledge
  - Reporting
  - Git and DevOps
  - Integrations
  - Security and administration
- **Agents**
  - Agent model and safety
  - Connect a coding agent
  - MCP tool reference
  - Agent workflow recipes
  - HTTP API
- **Build & operate**
  - Why I built it
  - Architecture
  - Enterprise deployment

Route and source mapping:

| Current source | Final slug | Sidebar label | Action |
|---|---|---|---|
| `index.mdx` | `overview` | Overview | Rewrite as `overview.md`; remove the root content route. |
| `features.md` | `features` | Feature map | Retain and fact-check. |
| `getting-started.md` | `getting-started` | Getting started | Retain and expand. |
| `using-the-app.md` | `using-the-app` | Using the app | Retain and update screenshots/links. |
| `guide/work-items.md` | `guide/work-items` | Work items | Retain. |
| `guide/planning-views.md` | `guide/planning-views` | Planning and views | Retain. |
| `guide/agile.md` | `guide/agile` | Agile workflows | Retain. |
| `guide/automations.md` | `guide/automations` | Automations | Retain. |
| `guide/automations-cookbook.md` | `guide/automations-cookbook` | Automation cookbook | Retain. |
| `guide/collaboration.md` | `guide/collaboration` | Collaboration and knowledge | Retain. |
| `guide/reporting.md` | `guide/reporting` | Reporting | Retain. |
| `guide/git-devops.md` | `guide/git-devops` | Git and DevOps | Retain. |
| `guide/integrations.md` | `guide/integrations` | Integrations | Retain. |
| `guide/security-admin.md` | `guide/security-admin` | Security and administration | Retain. |
| `guide/ai-agents.md` | `guide/ai-agents` | Agent model and safety | Retain; refocus the opening and safety cross-links. |
| `agents/mcp.md` | `agents/mcp` | MCP tool reference | Replace the thin 11-tool page with the complete grouped reference. |
| `agents/http-api.md` | `agents/http-api` | HTTP API | Reconcile with the canonical API reference. |
| `architecture.md` | `architecture` | Architecture | Retain and fact-check. |
| `enterprise.md` | `enterprise` | Enterprise deployment | Retain and fact-check. |
| — | `agents/connect` | Connect a coding agent | New page. |
| — | `agents/workflows` | Agent workflow recipes | New page. |
| — | `why-built` | Why I built it | New page. |
| — | `404.html` | Not in sidebar | New custom Astro error page. |

Other than the intentional root replacement, no existing route is renamed and no redirect is required.

## Visual system

Chosen direction: **Obsidian editorial**.

- Near-black blue-gray surfaces rather than pure black.
- Restrained cyan accent used for focus, primary actions, and small proof points.
- Neutral slate borders and text; no pervasive glow.
- One modern sans-serif stack for UI and editorial display, with a mono stack for code and metadata.
- Generous type scale and whitespace on the landing page; denser but readable reference pages.
- A subtle technical grid only in selected landing-page regions.
- Rounded rectangles remain restrained; cards use borders and tonal separation before shadows.
- Motion is limited to short entrance and hover transitions, with a complete `prefers-reduced-motion` fallback.
- Dark-first presentation with a fully functional light theme for Starlight content.

The system deliberately avoids reproducing the application’s older neon/cyberpunk density in the documentation brand.

## Screenshot treatment

Use the real `guide-board.jpg` asset because it contains a populated board and reads clearly at large size.

- Render it through Astro’s image pipeline with explicit dimensions.
- Place it in a semantic figure with descriptive alt text and a short caption.
- Wrap it in a minimal browser/product frame.
- Apply perspective, a small negative rotation, a subtle cyan edge, and a soft deep shadow using CSS.
- Keep the screenshot itself unmodified and truthful.
- Flatten the transform and reduce shadow on narrow screens.
- Make the hero image eager/high-priority; lazy-load supporting screenshots.

## Build story content

The build story is a substantial, first-person engineering case study, not a feature list. It covers:

- The observed coordination gap.
- The original product thesis.
- Target users and why enterprise primitives became dependencies of the wedge.
- The research benchmark and what it revealed about incumbents.
- The decision not to build another execution agent.
- The two-door model.
- The approval model: auto, changeset review, block.
- Why confidence thresholds were rejected.
- Why narrow typed operations matter for policy and auditability.
- The move from SQLite to Postgres and the feature-slice architecture.
- Tradeoffs, scope tension, and lessons from the implementation and code review.
- What the project proves today versus what remains a product ambition.

## Agent documentation

### Connect a coding agent

Provide one client-neutral setup first, then current, source-verified configuration examples for:

- Claude Code.
- OpenAI Codex.
- Cursor.
- Any stdio MCP client.

The sequence is always:

1. Run migrations.
2. Mint a workspace-scoped external agent key.
3. Keep the key outside version control.
4. Start Kanban locally or verify the reachable hosted `KANBAN_URL`.
5. Register the MCP server with a stable working directory or an absolute path to `mcp/server.mjs`, passing `KANBAN_URL`, `KANBAN_AGENT_KEY`, and optional `KANBAN_BOARD_ID`.
6. Ask the client to call `whoami` and `list_boards` as the connection test.

### MCP reference

Document the complete implemented tool surface, grouped by intent:

- Orientation.
- Finding work.
- Changing work.
- Checklists, custom fields, and time.
- Planning containers.
- Analytics, knowledge, notifications, git, and change feeds.

Also document resources, prompts, defaults, pagination, and structured errors. Avoid a fragile headline tool count where a grouped index is clearer; when a count is used, tie it to a dated implementation snapshot.

### Safety and correctness

Explain the behaviors an agent must understand:

- Workspace-scoped principal and RBAC.
- Exclusive claim leases and renewal.
- Dry runs for supported mutations.
- Idempotency keys on safe-to-retry creates.
- Read retry behavior and why arbitrary mutations are not retried.
- Approval outcomes: applied, held for review, blocked by policy.
- No delete/archive tools.
- Change feed as a nudge, task history as the record.
- Secret handling for agent keys.

### Workflow recipes

Include copyable procedures for:

- Pick up and complete one task.
- Triage a board without changing it.
- Move from task to branch/PR context and report back.
- Produce a standup from board analytics.
- Watch a board efficiently with `wait_for_changes`.
- Handle a claim conflict or held-for-review mutation correctly.

## Content corrections

- Remove or qualify the `132/140` shipped-completeness claim.
- Update the thin public MCP page to the actual implementation surface.
- Reconcile public agent docs with `mcp/server.mjs`, `mcp/README.md`, and `docs/agent-api.md`.
- Keep the eight board lenses where the current UI and UAT still support them.
- Use the newer populated board screenshot on the landing page.
- Apply one base-path convention: `.astro` and shared components use `withBase(import.meta.env.BASE_URL, path)`; Markdown/MDX uses relative internal links; content images use relative imports; canonical URLs come from Astro’s `site` and `base`.
- Update GitHub Actions versions to current official Astro Pages guidance.

## Accessibility and responsive behavior

Target WCAG 2.2 AA conventions:

- One visible `h1` per page and ordered headings.
- A skip link and semantic landmarks on the custom landing page.
- Keyboard-operable navigation and calls to action.
- Visible `:focus-visible` treatment that meets contrast requirements and remains at least partially visible when sticky UI is present (WCAG 2.2 SC 2.4.11).
- Pointer targets meet WCAG 2.2 SC 2.5.8: at least 24×24 CSS pixels or sufficient spacing under the criterion’s exceptions. Primary actions target 44×44 CSS pixels.
- Descriptive image alternatives and decorative assets hidden from assistive technology.
- No information conveyed by color alone.
- Text contrast of at least 4.5:1 for normal text and 3:1 for large text and UI boundaries.
- No horizontal page scrolling at 320px viewport width.
- Reduced-motion behavior that removes perspective animation and nonessential transitions.
- Automated browser DOM checks cover headings, landmarks, image alternatives, focusability, target size/spacing, overflow, and the active reduced-motion stylesheet on the landing page plus representative Starlight pages.
- Manual keyboard checks cover skip navigation, header navigation, all hero actions, sidebar/search controls, visible focus, and focus not obscured on the landing page, Getting started, and Connect a coding agent.

## Failure and edge handling

- Add a branded static 404 page suitable for GitHub Pages; its navigation uses the same `withBase()` helper as the landing page.
- Generated-link validation rejects root-absolute internal links that omit the configured base and duplicate `/kanban/kanban/` paths.
- Ensure the site remains useful with JavaScript disabled; search may enhance progressively, but documentation and navigation still render.
- If an external client’s MCP syntax changes, the generic stdio configuration remains the canonical fallback.
- Never embed real agent keys, personal tokens, or deployment secrets in examples.

## Verification

1. Run the Astro production build from `docs-site/`.
2. Validate generated internal links and asset paths under `/kanban`, rejecting missing targets, missing-base root links, and duplicate-base paths.
3. Start the built site and exercise the landing page and representative documentation routes in a real browser.
4. Check desktop and mobile layouts, including 320px width.
5. Run the automated DOM checks and the manual keyboard checks defined in the accessibility section, including forced reduced motion.
6. Confirm GitHub Pages workflow uses the configured `site` and `base`, current official Actions, Pages permissions, and deployment environment.
7. Confirm the generated output includes the custom 404 page and Pagefind search index.

## Non-goals

- Redesigning the Kanban application itself.
- Replacing Starlight’s documentation runtime.
- Adding a client-side framework or animation library for the landing page.
- Generating API claims that are not present in current code.
- Publishing live credentials or a hosted application demo.
