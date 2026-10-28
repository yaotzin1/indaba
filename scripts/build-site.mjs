/**
 * Builds the documentation site that GitHub Pages serves (.github/workflows/pages.yml).
 *
 *   node scripts/build-site.mjs            render docs/ and site/ into _site/
 *   node scripts/build-site.mjs --check    every page of docs/ is in the site's navigation (no node_modules needed)
 *
 * The site is docs/, not a copy of it: every Markdown page under docs/ is a page of the site, so the rule that
 * documentation moves with the change (workflow.ai.yml, architectural rules) keeps the site current too. The
 * landing page, the template, the styles and the animated illustration live in site/. A page added to docs/
 * must be named in PAGES (with its group) or in UNLISTED (with the reason), or --check fails the commit; that
 * is what stops a page from existing in the repository and missing from the site.
 *
 * Links: `x.md` becomes `x.html`, `assets/...` is copied as is, and a link that leaves docs/ (`../specs/`,
 * `../CONTRIBUTING.md`, `../examples/`) points at the file on GitHub, so nothing on the site is a dead link.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
export const REPO = 'https://github.com/yaotzin1/indaba';

/** The navigation, in order. `file` is relative to docs/; `blurb` is the line on the landing page's map. */
export const PAGES = [
    {
        group: 'Start here',
        items: [
            { file: 'getting-started.md', label: 'Getting started', blurb: 'Install, a first run, the commands' },
            { file: 'using-the-alpha.md', label: 'Using the alpha', blurb: 'API, ACP or CLI: which transport, when' },
            { file: 'positioning.md', label: 'What Indaba is', blurb: 'Who it is for, and what it is not' },
        ],
    },
    {
        group: 'Write workflows',
        items: [
            { file: 'workflow-format.md', label: 'Workflow format', blurb: 'Every field, guards, retries, MCP servers' },
            { file: 'extending.md', label: 'Extending', blurb: 'Plugins: runners, guards, arbiters, listeners, log sinks, the registry' },
        ],
    },
    {
        group: 'Watch and debug runs',
        items: [
            { file: 'web-view.md', label: 'Web view', blurb: 'indaba ui: runs, workflows and editing in a browser' },
            { file: 'logging.md', label: 'Logging', blurb: 'Logs, Graylog, collectors, indaba report' },
        ],
    },
    {
        group: 'The project',
        items: [
            { file: 'roadmap.md', label: 'Roadmap', blurb: 'What is built in which order' },
            { file: 'hosted-service.md', label: 'Hosted service', blurb: 'What a hosted Indaba would need' },
            { file: 'vision.md', label: 'Vision', blurb: 'The founding requirement: mission and modules' },
        ],
    },
    {
        group: 'Contributing',
        items: [
            { file: 'development-workflow.md', label: 'Development workflow', blurb: 'Tracks, stages and gates' },
            { file: 'web-view-development.md', label: 'Web view development', blurb: 'Changing the page of indaba ui' },
        ],
    },
];

/** Pages of docs/ that are deliberately not in the navigation, each with the reason. */
export const UNLISTED = {
    'README.md': 'the index of docs/ on GitHub; the site has its own landing page (site/index.html) with the same map',
};

const listed = () => PAGES.flatMap((g) => g.items.map((i) => i.file));

/** Problems with the navigation: pages missing from it, entries without a file, duplicates. */
export function checkNavigation(docFiles) {
    const problems = [];
    const nav = listed();
    const seen = new Set();
    for (const file of nav) {
        if (seen.has(file)) problems.push(`${file} is listed twice in PAGES`);
        seen.add(file);
        if (!docFiles.includes(file)) problems.push(`PAGES names docs/${file}, which does not exist`);
        if (file in UNLISTED) problems.push(`${file} is both in PAGES and in UNLISTED`);
    }
    for (const file of Object.keys(UNLISTED)) {
        if (!docFiles.includes(file)) problems.push(`UNLISTED names docs/${file}, which does not exist`);
    }
    for (const file of docFiles) {
        if (!seen.has(file) && !(file in UNLISTED)) {
            problems.push(
                `docs/${file} is not on the site: add it to PAGES in scripts/build-site.mjs (or to UNLISTED with the reason)`,
            );
        }
    }
    return problems;
}

/** A heading's id, the way GitHub makes it, so `#logs` style links written for GitHub keep working. */
export function slug(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/&[a-z]+;|&#\d+;/g, '')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-');
}

/** Where a link written in docs/<from> points on the site. */
export function rewriteHref(href, pages) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return href;
    const hashAt = href.indexOf('#');
    const target = hashAt === -1 ? href : href.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : href.slice(hashAt);
    const resolved = path.posix.normalize(path.posix.join('docs', target));
    if (resolved.startsWith('docs/')) {
        const inside = resolved.slice('docs/'.length);
        if (inside.endsWith('.md') && pages.has(inside)) return `${htmlName(inside)}${hash}`;
        if (inside.startsWith('assets/')) return `${inside}${hash}`;
    }
    const kind = target.endsWith('/') || !path.posix.extname(resolved) ? 'tree' : 'blob';
    return `${REPO}/${kind}/main/${resolved.replace(/\/$/, '')}${hash}`;
}

export const htmlName = (file) => (file === 'README.md' ? 'docs.html' : file.replace(/\.md$/, '.html'));

const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function docFilesOf() {
    return fs
        .readdirSync(DOCS)
        .filter((f) => f.endsWith('.md'))
        .sort();
}

async function build() {
    const { Marked } = await import('marked');
    const template = fs.readFileSync(path.join(SITE, 'template.html'), 'utf8');
    const pages = new Set([...listed(), ...Object.keys(UNLISTED)]);
    const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
    const built = /^[0-9a-f]{7}$/.test(sha) ? ` at <a href="${REPO}/commit/${sha}">${sha}</a>` : '';

    const fill = (body, { title, description, current }) => {
        let html = template
            .replace('@@BODY@@', () => body)
            .replace('@@TITLE@@', escapeHtml(title))
            .replace('@@DESCRIPTION@@', escapeHtml(description))
            .replace('@@BUILT@@', built)
            .replaceAll('@@REPO@@', REPO);
        html = html.replace(/@@CUR:([a-z-]+)@@/g, (_, id) => (id === current ? ' aria-current="page"' : ''));
        return html;
    };

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, 'site', 'fonts'), { recursive: true });
    fs.cpSync(path.join(DOCS, 'assets'), path.join(OUT, 'assets'), { recursive: true });
    for (const f of ['site.css', 'site.js']) fs.copyFileSync(path.join(SITE, f), path.join(OUT, 'site', f));
    const fontsource = path.join(ROOT, 'packages', 'web', 'node_modules', '@fontsource');
    const fonts = {
        'next-400.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2',
        'next-700.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2',
        'next-800.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-800-normal.woff2',
        'mono-400.woff2': 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2',
        'OFL.txt': 'atkinson-hyperlegible-next/LICENSE',
    };
    for (const [name, from] of Object.entries(fonts)) {
        fs.copyFileSync(path.join(fontsource, from), path.join(OUT, 'site', 'fonts', name));
    }
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

    const sidenav = (current) =>
        PAGES.map(
            (g) =>
                `<h2>${escapeHtml(g.group)}</h2><ul>${g.items
                    .map(
                        (i) =>
                            `<li><a href="${htmlName(i.file)}"${i.file === current ? ' aria-current="page"' : ''}>${escapeHtml(i.label)}</a></li>`,
                    )
                    .join('')}</ul>`,
        ).join('');

    for (const file of pages) {
        const source = fs.readFileSync(path.join(DOCS, file), 'utf8');
        const headings = [];
        const used = new Map();
        const marked = new Marked({ gfm: true });
        marked.use({
            renderer: {
                heading({ tokens, depth }) {
                    const inner = this.parser.parseInline(tokens);
                    let id = slug(inner);
                    const n = used.get(id) ?? 0;
                    used.set(id, n + 1);
                    if (n > 0) id = `${id}-${n}`;
                    if (depth === 2 || depth === 3) headings.push({ depth, id, inner });
                    if (depth === 1) return `<h1 id="${id}">${inner}</h1>\n`;
                    return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
                },
                link({ href, title, tokens }) {
                    const t = title ? ` title="${escapeHtml(title)}"` : '';
                    return `<a href="${escapeHtml(rewriteHref(href, pages))}"${t}>${this.parser.parseInline(tokens)}</a>`;
                },
                image({ href, title, text }) {
                    const t = title ? ` title="${escapeHtml(title)}"` : '';
                    return `<img src="${escapeHtml(rewriteHref(href, pages))}" alt="${escapeHtml(text)}"${t} loading="lazy">`;
                },
                table(token) {
                    return `<div class="table-wrap">${marked.Renderer.prototype.table.call(this, token)}</div>`;
                },
            },
        });
        const content = marked.parse(source);
        const h1 = /^#\s+(.+)$/m.exec(source);
        const heading = h1?.[1]?.replace(/`/g, '') ?? file;
        const firstPara = source
            .split(/\n\s*\n/)
            .find((p) => p.trim() && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('```'));
        const description = (firstPara ?? heading)
            .replace(/\s+/g, ' ')
            .replace(/[`*_]/g, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .slice(0, 180);
        const toc = headings.length
            ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${headings
                  .map((h) => `<li class="l${h.depth}"><a href="#${h.id}">${h.inner.replace(/<[^>]*>/g, '')}</a></li>`)
                  .join('')}</ul></nav>`
            : '<div></div>';
        const body = `<div class="doc">
<nav class="sidenav" aria-label="Documentation">${sidenav(file)}</nav>
<main id="main" class="prose">${content}
<div class="pagefoot"><a href="${REPO}/edit/main/docs/${file}">Edit this page on GitHub</a><a href="${REPO}/blob/main/docs/${file}">View the Markdown</a></div>
</main>
${toc}
</div>`;
        const current = file.replace(/\.md$/, '');
        fs.writeFileSync(
            path.join(OUT, htmlName(file)),
            fill(body, { title: `${heading} · Indaba`, description, current }),
        );
    }

    const docmap = `<div class="map-grid">${PAGES.map(
        (g) =>
            `<div><h3>${escapeHtml(g.group)}</h3><ul>${g.items
                .map(
                    (i) =>
                        `<li><a href="${htmlName(i.file)}">${escapeHtml(i.label)}</a><span>${escapeHtml(i.blurb)}</span></li>`,
                )
                .join('')}</ul></div>`,
    ).join('')}</div>`;
    const landing = fs
        .readFileSync(path.join(SITE, 'index.html'), 'utf8')
        .replace('@@HERO@@', () => fs.readFileSync(path.join(SITE, 'hero.svg'), 'utf8'))
        .replace('@@DOCMAP@@', () => docmap)
        .replaceAll('@@REPO@@', REPO);
    fs.writeFileSync(
        path.join(OUT, 'index.html'),
        fill(landing, {
            title: 'Indaba · let your agents argue, ship what they agree on',
            description:
                'A deterministic engine for multi-agent AI workflows: a graph of steps with quality gates, agents that debate to consensus, any runner, and traces with token and cost accounting.',
            current: 'index',
        }),
    );
    return pages.size + 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const problems = checkNavigation(docFilesOf());
    if (problems.length > 0) {
        for (const p of problems) console.error(`site: ${p}`);
        process.exit(1);
    }
    if (process.argv.includes('--check')) {
        console.log(`site: every page of docs/ is on the site (${listed().length} in the navigation)`);
    } else {
        const count = await build();
        console.log(`site: wrote ${count} pages to _site/`);
    }
}
