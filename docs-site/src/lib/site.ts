const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export const repositoryUrl = 'https://github.com/seanrobertwright/kanban';
export const siteName = 'Kanban';

export function withBase(path = ''): string {
	if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('mailto:') || path.startsWith('#')) {
		return path;
	}

	const normalized = path.replace(/^\/+/, '');
	return normalized ? `${basePath}/${normalized}` : `${basePath}/`;
}
