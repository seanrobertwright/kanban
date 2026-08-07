import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const base = '/kanban';
const siteOrigin = 'https://seanrobertwright.github.io';
const failures = [];
const htmlCache = new Map();

async function walk(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await walk(path));
		else files.push(path);
	}
	return files;
}

function decodeEntities(value) {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function pagePath(file) {
	const local = relative(distRoot, file).split(sep).join('/');
	if (local === 'index.html') return `${base}/`;
	if (local.endsWith('/index.html')) return `${base}/${local.slice(0, -'index.html'.length)}`;
	return `${base}/${local}`;
}

function references(html) {
	const found = [];
	const attributePattern = /\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	for (const match of html.matchAll(attributePattern)) {
		const attribute = match[1].toLowerCase();
		const value = decodeEntities(match[2] ?? match[3] ?? '').trim();
		if (attribute !== 'srcset') {
			found.push({ attribute, value });
			continue;
		}
		if (value.startsWith('data:')) continue;
		for (const candidate of value.split(',')) {
			const url = candidate.trim().split(/\s+/, 1)[0];
			if (url) found.push({ attribute, value: url });
		}
	}
	return found;
}

function isNonNavigational(value) {
	return value === '' || /^(?:mailto:|tel:|data:|blob:)/i.test(value);
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveTarget(pathname) {
	let local = pathname.slice(base.length).replace(/^\/+/, '');
	try {
		local = decodeURIComponent(local);
	} catch {
		return null;
	}

	const direct = join(distRoot, local);
	const candidates = pathname.endsWith('/')
		? [join(direct, 'index.html')]
		: extname(local)
			? [direct]
			: [`${direct}.html`, join(direct, 'index.html')];
	for (const candidate of candidates) {
		if (await exists(candidate)) return candidate;
	}
	return null;
}

async function hasFragment(file, fragment) {
	if (!fragment) return true;
	if (!file.endsWith('.html')) return false;
	let html = htmlCache.get(file);
	if (!html) {
		html = await readFile(file, 'utf8');
		htmlCache.set(file, html);
	}
	let decoded;
	try {
		decoded = decodeURIComponent(fragment);
	} catch {
		return false;
	}
	const ids = new Set([...html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].map((match) => decodeEntities(match[1] ?? match[2])));
	return ids.has(decoded);
}

function report(source, attribute, value, reason) {
	failures.push(`${relative(distRoot, source)}: ${attribute}="${value}" — ${reason}`);
}

const htmlFiles = (await walk(distRoot)).filter((file) => file.endsWith('.html'));
for (const source of htmlFiles) {
	const html = await readFile(source, 'utf8');
	for (const { attribute, value } of references(html)) {
		if (isNonNavigational(value)) continue;
		if (value.includes(`${base}${base}/`) || value.includes(`${base}/${base.replace(/^\//, '')}/`)) {
			report(source, attribute, value, 'duplicate base path');
			continue;
		}
		if (value.startsWith('/') && !value.startsWith(`${base}/`) && value !== base) {
			report(source, attribute, value, `root-absolute internal URL is missing ${base}`);
			continue;
		}

		let resolved;
		try {
			resolved = new URL(value, `${siteOrigin}${pagePath(source)}`);
		} catch {
			report(source, attribute, value, 'invalid URL');
			continue;
		}
		if (resolved.origin !== siteOrigin) continue;
		if (resolved.pathname !== base && !resolved.pathname.startsWith(`${base}/`)) {
			report(source, attribute, value, `resolved outside ${base}`);
			continue;
		}

		const target = await resolveTarget(resolved.pathname === base ? `${base}/` : resolved.pathname);
		if (!target) {
			report(source, attribute, value, 'missing target');
			continue;
		}
		if (!(await hasFragment(target, resolved.hash.slice(1)))) {
			report(source, attribute, value, `missing fragment ${resolved.hash}`);
		}
	}
}

if (failures.length > 0) {
	console.error(`Found ${failures.length} broken internal reference${failures.length === 1 ? '' : 's'}:\n`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`Validated ${htmlFiles.length} HTML files under ${base}.`);
}
