import { lstat, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticFile {
  readonly type: string;
  readonly body: Buffer;
}

/**
 * The file a request path names inside `root`, or undefined. The path is confined to the root: it is decoded once,
 * refused if it holds a NUL, a backslash or a `..` segment, joined under the root, and read only if it is a plain
 * file (a symbolic link is not followed). A path with no extension that names nothing is the page itself, so
 * client-side routes survive a reload.
 */
export async function readStatic(root: string, urlPath: string): Promise<StaticFile | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    return undefined;
  }
  const base = resolve(root);
  const wanted = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const direct = await readInside(base, wanted);
  if (direct !== undefined) {
    return direct;
  }
  return extname(wanted) === '' ? readInside(base, 'index.html') : undefined;
}

async function readInside(base: string, relative: string): Promise<StaticFile | undefined> {
  const file = resolve(join(base, relative));
  if (file !== base && !file.startsWith(base + sep)) {
    return undefined;
  }
  try {
    const info = await lstat(file);
    if (!info.isFile()) {
      return undefined;
    }
    return {
      type: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      body: await readFile(file),
    };
  } catch {
    return undefined;
  }
}
