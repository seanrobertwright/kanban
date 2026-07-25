// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed to GitHub Pages at https://seanrobertwright.github.io/kanban/
// by .github/workflows/deploy-docs.yml — `site` + `base` must match that
// origin/path pair or every asset link 404s.
export default defineConfig({
	site: 'https://seanrobertwright.github.io',
	base: '/kanban',
	integrations: [
		starlight({
			title: 'Kanban',
			description:
				'A self-hosted, agent-native kanban and work-management platform.',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/seanrobertwright/kanban',
				},
			],
			customCss: ['./src/styles/neon.css'],
			sidebar: [
				{
					label: 'Start',
					items: [
						{ label: 'Introduction', slug: 'index' },
						{ label: 'Getting started', slug: 'getting-started' },
					],
				},
				{
					label: 'Product',
					items: [
						{ label: 'Feature overview', slug: 'features' },
						{ label: 'Using the app', slug: 'using-the-app' },
					],
				},
				{
					label: 'Guide',
					// Ten capability-area pages, ordered by their frontmatter
					// `sidebar.order` (work items → planning → agile → … → AI).
					items: [{ autogenerate: { directory: 'guide' } }],
				},
				{
					label: 'Agents',
					items: [
						{ label: 'Agent HTTP API', slug: 'agents/http-api' },
						{ label: 'MCP server', slug: 'agents/mcp' },
					],
				},
				{
					label: 'Operate',
					items: [
						{ label: 'Architecture', slug: 'architecture' },
						{ label: 'Enterprise deployment', slug: 'enterprise' },
					],
				},
			],
		}),
	],
});
