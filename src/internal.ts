/** Helpers shared by both dialects. Not exported from the package root. */

/** Thrown for every parse failure. `message` is the text the Go library returns. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const encoder = new TextEncoder();

/** Length in UTF-8 bytes, which is what Go's `len` reports for a string. */
export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

const printable = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;
const escapes: Record<number, string> = {
  7: '\\a',
  8: '\\b',
  12: '\\f',
  10: '\\n',
  13: '\\r',
  9: '\\t',
  11: '\\v',
};

/** Go's `strconv.Quote`, which `%q` uses. */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp < 0x80 && cp >= 0x20 && cp !== 0x7f) out += ch;
    else if (cp >= 0x80 && printable.test(ch)) out += ch;
    else if (escapes[cp] !== undefined) out += escapes[cp];
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp < 0x10000) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += '\\U' + cp.toString(16).padStart(8, '0');
  }
  return out + '"';
}

/**
 * Go's stable sort. For up to 20 elements Go runs insertion sort, and this does
 * the same so results match even when the comparison is not a strict weak order.
 * Longer inputs use the built-in stable sort.
 */
export function stableSort<T>(items: readonly T[], less: (a: T, b: T) => boolean): T[] {
  const a = items.slice();
  if (a.length <= 20) {
    for (let i = 1; i < a.length; i++) {
      for (let j = i; j > 0 && less(a[j] as T, a[j - 1] as T); j--) {
        const t = a[j] as T;
        a[j] = a[j - 1] as T;
        a[j - 1] = t;
      }
    }
    return a;
  }
  return a.sort((x, y) => (less(x, y) ? -1 : less(y, x) ? 1 : 0));
}
