// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages publishes this project at the repository subpath below.
export default defineConfig({
	site: 'https://seanrobertwright.github.io',
	base: '/kanban',
	integrations: [
		starlight({
			title: 'Kanban',
			description: 'A self-hosted coordination surface for people and coding agents.',
			disable404Route: true,
			components: {
				Search: './src/components/Search.astro',
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/seanrobertwright/kanban',
				},
			],
			customCss: ['./src/styles/theme.css'],
			sidebar: [
				{
					label: 'Start',
					items: [
						{ label: 'Overview', slug: 'overview' },
						{ label: 'Feature overview', slug: 'features' },
						{ label: 'Getting started', slug: 'getting-started' },
						{ label: 'Using the app', slug: 'using-the-app' },
					],
				},
				{
					label: 'Use',
					items: [
						{ label: 'Work items', slug: 'guide/work-items' },
						{ label: 'Planning views', slug: 'guide/planning-views' },
						{ label: 'Agile delivery', slug: 'guide/agile' },
						{ label: 'Automations', slug: 'guide/automations' },
						{ label: 'Automation cookbook', slug: 'guide/automations-cookbook' },
						{ label: 'Collaboration & knowledge', slug: 'guide/collaboration' },
						{ label: 'Integrations', slug: 'guide/integrations' },
						{ label: 'Git & development', slug: 'guide/git-devops' },
						{ label: 'Reporting', slug: 'guide/reporting' },
						{ label: 'Security & administration', slug: 'guide/security-admin' },
					],
				},
				{
					label: 'Agents',
					items: [
						{ label: 'AI agents', slug: 'guide/ai-agents' },
						{ label: 'Connect an agent', slug: 'agents/connect' },
						{ label: 'The Kanban skill', slug: 'agents/skill' },
						{ label: 'MCP reference', slug: 'agents/mcp' },
						{ label: 'Agent workflows', slug: 'agents/workflows' },
						{ label: 'The CLI', slug: 'agents/cli' },
						{ label: 'HTTP API', slug: 'agents/http-api' },
						{
							label: 'Archon',
							badge: { text: 'BETA', variant: 'caution' },
							items: [
								{ label: 'Kanban + Archon', slug: 'agents/archon' },
								{ label: 'Workflow recipes', slug: 'agents/archon-recipes' },
							],
						},
					],
				},
				{
					label: 'Build & operate',
					items: [
						{ label: 'Why I built Kanban', slug: 'why-built' },
						{ label: 'Architecture', slug: 'architecture' },
						{ label: 'Enterprise deployment', slug: 'enterprise' },
					],
				},
			],
		}),
	],
});
