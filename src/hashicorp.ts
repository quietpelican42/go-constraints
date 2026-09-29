/*
 * Reimplementation of the behavior of github.com/hashicorp/go-version v1.9.0.
 *
 * hashicorp/go-version is MPL-2.0. This file is written from the library's
 * documented behavior and from differential runs against it, not ported from
 * its source, and contains none of its code.
 */
import { ParseError, stableSort } from './internal.ts';

const S = '[\\t\\n\\f\\r ]';
const MAX_INT64 = (1n << 63n) - 1n;

// The version grammar, built piece by piece.
const NUMBERS = '([0-9]+(?:\\.[0-9]+)*?)';
const PRE_CHARS = '[0-9A-Za-z\\-~]';
const DOTTED = `(?:\\.[0-9A-Za-z\\-~]+)*`;
const HYPHEN_PRE = `-([0-9]+${PRE_CHARS}*${DOTTED})`;
const BARE_PRE = `-?([A-Za-z\\-~]+${PRE_CHARS}*${DOTTED})`;
const META = `\\+([0-9A-Za-z\\-~]+${DOTTED})`;
const SEMVER_BARE_PRE = `-([A-Za-z\\-~]+${PRE_CHARS}*${DOTTED})`;

function grammar(barePre: string): string {
  return `v?${NUMBERS}(?:${HYPHEN_PRE}|${barePre})?(?:${META})??`;
}
const versionRe = new RegExp(`^${grammar(BARE_PRE)}$`);
const semverRe = new RegExp(`^${grammar(SEMVER_BARE_PRE)}$`);
const constraintRe = new RegExp(`^${S}*(<=|>=|!=|~>|<|>|=|)${S}*(${grammar(BARE_PRE)})${S}*$`);

function parseInt64(s: string): bigint {
  const n = BigInt(s);
  if (n > MAX_INT64) {
    throw new ParseError(`error parsing version: strconv.ParseInt: parsing "${s}": value out of range`);
  }
  return n;
}

function build(v: string, re: RegExp, original: string): Version {
  const m = re.exec(v);
  if (m === null) throw new ParseError(`malformed version: ${v}`);
  const written = (m[1] as string).split('.');
  const segments = written.map(parseInt64);
  while (segments.length < 3) segments.push(0n);
  // Group 2 is a hyphenated prerelease, group 3 the bare form. The bare form wins when both exist.
  const pre = m[3] || m[2] || '';
  return new Version(segments, written.length, pre, m[4] ?? '', original);
}

// Prerelease parts compare numerically only when they parse as a signed 64-bit integer,
// which includes a leading '-' because '-' is a legal prerelease character.
function asInt(s: string): bigint | undefined {
  if (!/^-?[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s);
  return n > MAX_INT64 || n < -MAX_INT64 - 1n ? undefined : n;
}

function comparePart(a: string, b: string): number {
  if (a === b) return 0;
  const ai = asInt(a);
  const bi = asInt(b);
  if (a === '') return bi !== undefined ? -1 : 1;
  if (b === '') return ai !== undefined ? 1 : -1;
  if (ai !== undefined && bi === undefined) return -1;
  if (ai === undefined && bi !== undefined) return 1;
  if (ai === undefined && bi === undefined) return a > b ? 1 : -1;
  return (ai as bigint) > (bi as bigint) ? 1 : -1;
}

function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  const x = a.split('.');
  const y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = comparePart(x[i] ?? '', y[i] ?? '');
    if (d !== 0) return d;
  }
  return 0;
}

/** A parsed version. Any number of numeric segments is allowed; fewer than three are padded with zeros. */
export class Version {
  /** Numeric segments, padded to at least three. */
  readonly segments: readonly bigint[];
  /** How many segments were written in the source string. */
  readonly written: number;
  readonly prerelease: string;
  readonly metadata: string;
  /** The string that was parsed, unchanged. */
  readonly original: string;

  constructor(segments: readonly bigint[], written: number, prerelease: string, metadata: string, original: string) {
    this.segments = segments;
    this.written = written;
    this.prerelease = prerelease;
    this.metadata = metadata;
    this.original = original;
  }

  /** Go's `NewVersion`: optional `v`, any number of segments, and a prerelease with or without a hyphen. */
  static parse(v: string): Version {
    return build(v, versionRe, v);
  }

  /** Go's `NewSemver`: like `parse` but a prerelease needs its hyphen. */
  static parseSemver(v: string): Version {
    return build(v, semverRe, v);
  }

  static isValid(v: string): boolean {
    try {
      Version.parse(v);
      return true;
    } catch {
      return false;
    }
  }

  /** Canonical form: segments as parsed (`1.0` becomes `1.0.0`), then `-pre` and `+meta`. */
  toString(): string {
    let s = this.segments.join('.');
    if (this.prerelease !== '') s += `-${this.prerelease}`;
    if (this.metadata !== '') s += `+${this.metadata}`;
    return s;
  }

  /** The first three segments, without prerelease or metadata. */
  core(): Version {
    const [a, b, c] = this.segments as [bigint, bigint, bigint];
    return Version.parse(`${a}.${b}.${c}`);
  }

  equalSegments(o: Version): boolean {
    return this.segments.length === o.segments.length && this.segments.every((s, i) => s === o.segments[i]);
  }

  /** Returns -1, 0 or 1. Metadata is ignored. Missing trailing segments count as zero. */
  compare(o: Version): number {
    if (this.equalSegments(o)) {
      const a = this.prerelease;
      const b = o.prerelease;
      if (a === '' && b === '') return 0;
      if (a === '') return 1;
      if (b === '') return -1;
      return comparePrerelease(a, b);
    }
    const n = Math.max(this.segments.length, o.segments.length);
    for (let i = 0; i < n; i++) {
      const x = this.segments[i] ?? 0n;
      const y = o.segments[i] ?? 0n;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  equal(o: Version): boolean {
    return this.compare(o) === 0;
  }
  lessThan(o: Version): boolean {
    return this.compare(o) < 0;
  }
  greaterThan(o: Version): boolean {
    return this.compare(o) > 0;
  }
}

/** Sorts ascending with Go's stable sort. */
export function sortVersions(versions: readonly (Version | string)[]): Version[] {
  return stableSort(
    versions.map((v) => (typeof v === 'string' ? Version.parse(v) : v)),
    (a, b) => a.lessThan(b),
  );
}

// ---------------------------------------------------------------------------

type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~>';

// Order used when sorting constraints: the code points of the operator symbols Go uses.
const OP_RANK: Record<Operator, number> = { '<': 60, '=': 61, '>': 62, '~>': 126, '!=': 8800, '<=': 8804, '>=': 8805 };

/** One operator and version, such as `>= 1.2`. */
export class Constraint {
  readonly operator: Operator;
  readonly version: Version;
  /** The text between commas, exactly as written. */
  readonly original: string;

  constructor(operator: Operator, version: Version, original: string) {
    this.operator = operator;
    this.version = version;
    this.original = original;
  }

  static parse(text: string): Constraint {
    const m = constraintRe.exec(text);
    if (m === null) throw new ParseError(`malformed constraint: ${text}`);
    const version = Version.parse(m[2] as string);
    return new Constraint((m[1] || '=') as Operator, version, text);
  }

  check(v: Version): boolean {
    const c = this.version;
    switch (this.operator) {
      case '=':
        return v.equal(c);
      case '!=':
        return !v.equal(c);
      case '>':
        return prereleaseOk(v, c) && v.compare(c) > 0;
      case '<':
        return prereleaseOk(v, c) && v.compare(c) < 0;
      case '>=':
        return prereleaseOk(v, c) && v.compare(c) >= 0;
      case '<=':
        return prereleaseOk(v, c) && v.compare(c) <= 0;
      case '~>':
        return pessimistic(v, c);
    }
  }

  toString(): string {
    return this.original;
  }
}

// A prerelease version only satisfies an ordering constraint when the constraint
// also names a prerelease of the same segments.
function prereleaseOk(v: Version, c: Version): boolean {
  const vPre = v.prerelease !== '';
  const cPre = c.prerelease !== '';
  if (vPre && cPre) return v.equalSegments(c);
  if (vPre) return false;
  return true;
}

function pessimistic(v: Version, c: Version): boolean {
  if (!prereleaseOk(v, c)) return false;
  if (c.prerelease !== '' && v.prerelease === '') return false;
  if (v.lessThan(c)) return false;
  const padded = c.segments.length;
  if (padded > v.segments.length) return false;
  // Every segment before the last one written must match exactly.
  for (let i = 0; i < c.written - 1; i++) {
    if (v.segments[i] !== c.segments[i]) return false;
  }
  // The final padded segment may only be equal or higher in the checked version.
  return (c.segments[padded - 1] as bigint) <= (v.segments[padded - 1] as bigint);
}

/** A comma-separated list of constraints, all of which must hold. */
export class Constraints {
  readonly items: readonly Constraint[];

  constructor(items: readonly Constraint[]) {
    this.items = items;
  }

  /** Go's `NewConstraint`. */
  static parse(input: string): Constraints {
    return new Constraints(input.split(',').map((p) => Constraint.parse(p)));
  }

  static isValid(input: string): boolean {
    try {
      Constraints.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  check(v: Version | string): boolean {
    const ver = typeof v === 'string' ? Version.parse(v) : v;
    return this.items.every((c) => c.check(ver));
  }

  /** A copy ordered by operator, then version (stable). */
  sort(): Constraints {
    return new Constraints(
      stableSort(this.items, (a, b) => {
        const ra = OP_RANK[a.operator];
        const rb = OP_RANK[b.operator];
        if (ra !== rb) return ra < rb;
        return a.version.lessThan(b.version);
      }),
    );
  }

  /** The original texts joined by a comma. */
  toString(): string {
    return this.items.map((c) => c.original).join(',');
  }
}

/** Parses both arguments and checks the version against the constraints. Throws ParseError on bad input. */
export function satisfies(version: string, constraints: string): boolean {
  return Constraints.parse(constraints).check(Version.parse(version));
}
