/** Longest pattern or path accepted. Anything longer never matches, which fails closed for an allow list. */
const MAX_LENGTH = 1024;

function segments(value: string): string[] {
  return value
    .replaceAll('\\', '/')
    .replace(/^(\.\/)+/, '')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
}

/** One path segment against one pattern segment: `*` any run, `?` one character. Iterative, no backtracking blow-up. */
function matchSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') {
    p++;
  }
  return p === pattern.length;
}

/**
 * Glob match on `/`-separated paths, case-sensitive: `*` and `?` stay inside one segment, a whole
 * segment `**` matches any number of segments (including none). `\` in either argument is a separator.
 * A path with a `..` segment never matches. Patterns are never turned into regular expressions.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  if (pattern.length > MAX_LENGTH || path.length > MAX_LENGTH) {
    return false;
  }
  const pat = segments(pattern);
  const parts = segments(path);
  if (parts.includes('..')) {
    return false;
  }

  const memo = new Map<number, boolean>();
  const walk = (pi: number, si: number): boolean => {
    const key = pi * (parts.length + 1) + si;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
    let result: boolean;
    if (pi === pat.length) {
      result = si === parts.length;
    } else if (pat[pi] === '**') {
      result = walk(pi + 1, si) || (si < parts.length && walk(pi, si + 1));
    } else {
      const part = parts[si];
      const current = pat[pi];
      result =
        part !== undefined && current !== undefined && matchSegment(current, part) && walk(pi + 1, si + 1);
    }
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

export function matchesAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, path));
}
