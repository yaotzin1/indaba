/**
 * Agent and command output is untrusted text on a programmable surface. The filter that keeps only what is safe to
 * print lives in `@indaba/engine` (the plain run view and the terminal UI need it too); these are its names here.
 */
export {
  createSanitizer as createPrintableFilter,
  type Sanitizer as PrintableFilter,
  sanitize as printableText,
} from '@indaba/engine';
