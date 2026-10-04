import { IndabaError } from '@indaba/core';

const REFERENCE = /\$\{\{\s*artifacts\.([A-Za-z0-9_-]+)\s*\}\}/g;

/** Resolves `${{ artifacts.name }}` references. */
export class Interpolator {
  constructor(private readonly artifacts: Readonly<Record<string, string>>) {}

  interpolate(value: string): string {
    return value.replace(REFERENCE, (_match, name: string) => {
      const resolved = Object.hasOwn(this.artifacts, name) ? this.artifacts[name] : undefined;
      if (resolved === undefined) {
        throw new IndabaError(`unknown artifact "${name}"`);
      }
      return resolved;
    });
  }
}
