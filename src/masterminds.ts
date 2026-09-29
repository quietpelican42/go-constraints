/*
 * Port of github.com/Masterminds/semver/v3 v3.5.0 (version.go, constraints.go).
 * Copyright (C) 2014-2019, Matt Butcher and Matt Farina. MIT licensed; the
 * license text is in LICENSE-masterminds-semver.
 */
import { ParseError, byteLength, goQuote, stableSort } from './internal.ts';

const MAX_VERSION_LEN = 256;
const MAX_CONSTRAINT_LEN = 512;
const MAX_CONSTRAINT_GROUPS = 32;
const MAX_UINT64 = (1n << 64n) - 1n;

// Go's \s is exactly [\t\n\f\r ]; JavaScript's is wider, so it is spelled out.
const S = '[\\t\\n\\f\\r ]';

const looseVersion = new RegExp(
  '^v?([0-9]+)(\\.[0-9]+)?(\\.[0-9]+)?' +
    '(-([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?' +
    '(\\+([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?$',
);

const NUM = '0123456789';
const ALLOWED = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-' + NUM;

function containsOnly(s: string, comp: string): boolean {
  for (const ch of s) if (!comp.includes(ch)) return false;
  return true;
}

/** strconv.ParseUint(s, 10, 64) as a bigint, throwing Go's error text. */
function parseUint(s: string): bigint {
  if (s === '' || !/^[0-9]+$/.test(s)) {
    throw new ParseError(`strconv.ParseUint: parsing ${goQuote(s)}: invalid syntax`);
  }
  const n = BigInt(s);
  if (n > MAX_UINT64) {
    throw new ParseError(`strconv.ParseUint: parsing ${goQuote(s)}: value out of range`);
  }
  return n;
}

function parseSegment(s: string): bigint {
  try {
    return parseUint(s);
  } catch (e) {
    throw new ParseError(`error parsing version segment: ${(e as Error).message}`);
  }
}

function validatePrerelease(p: string): void {
  for (const part of p.split('.')) {
    if (part === '') throw new ParseError('invalid prerelease string');
    if (containsOnly(part, NUM)) {
      if (part.length > 1 && part[0] === '0') throw new ParseError('version segment starts with 0');
    } else if (!containsOnly(part, ALLOWED)) {
      throw new ParseError('invalid prerelease string');
    }
  }
}

function validateMetadata(m: string): void {
  for (const part of m.split('.')) {
    if (part === '' || !containsOnly(part, ALLOWED)) throw new ParseError('invalid metadata string');
  }
}

function isNumeric(s: string): boolean {
  return /^[0-9]+$/.test(s) && BigInt(s) <= MAX_UINT64;
}

function comparePrePart(s: string, o: string): number {
  if (s === o) return 0;
  if (s === '') return o !== '' ? -1 : 1;
  if (o === '') return s !== '' ? 1 : -1;
  const sNum = isNumeric(s);
  const oNum = isNumeric(o);
  if (!sNum && !oNum) return s > o ? 1 : -1;
  if (!oNum) return -1;
  if (!sNum) return 1;
  return BigInt(s) > BigInt(o) ? 1 : -1;
}

function comparePrerelease(v: string, o: string): number {
  const sp = v.split('.');
  const op = o.split('.');
  const n = Math.max(sp.length, op.length);
  for (let i = 0; i < n; i++) {
    const d = comparePrePart(sp[i] ?? '', op[i] ?? '');
    if (d !== 0) return d;
  }
  return 0;
}

function cmpBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A parsed semantic version. Major, minor and patch are unsigned 64-bit values. */
export class Version {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
  readonly prerelease: string;
  readonly metadata: string;
  /** The string that was parsed, unchanged (including any `v` prefix). */
  readonly original: string;

  constructor(major: bigint, minor: bigint, patch: bigint, prerelease = '', metadata = '', original?: string) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = prerelease;
    this.metadata = metadata;
    this.original = original ?? this.toString();
  }

  /** Go's `NewVersion`: accepts a `v` prefix and missing minor or patch. */
  static parse(v: string): Version {
    if (byteLength(v) > MAX_VERSION_LEN) {
      throw new ParseError(`version string is too long (max ${MAX_VERSION_LEN} bytes)`);
    }
    const m = looseVersion.exec(v);
    if (m === null) throw new ParseError('invalid semantic version');
    const major = parseSegment(m[1] as string);
    const minor = m[2] ? parseSegment(m[2].slice(1)) : 0n;
    const patch = m[3] ? parseSegment(m[3].slice(1)) : 0n;
    const pre = m[5] ?? '';
    const meta = m[8] ?? '';
    if (pre !== '') validatePrerelease(pre);
    if (meta !== '') validateMetadata(meta);
    return new Version(major, minor, patch, pre, meta, v);
  }

  /** Go's `StrictNewVersion`: exactly MAJOR.MINOR.PATCH, no `v`, no leading zeros. */
  static parseStrict(v: string): Version {
    if (v.length === 0) throw new ParseError('version string empty');
    if (byteLength(v) > MAX_VERSION_LEN) {
      throw new ParseError(`version string is too long (max ${MAX_VERSION_LEN} bytes)`);
    }
    const first = v.indexOf('.');
    const second = first < 0 ? -1 : v.indexOf('.', first + 1);
    if (second < 0) throw new ParseError('invalid semantic version');
    const parts = [v.slice(0, first), v.slice(first + 1, second), v.slice(second + 1)];
    let pre = '';
    let meta = '';
    let last = parts[2] as string;
    if (last.includes('+')) {
      const i = last.indexOf('+');
      meta = last.slice(i + 1);
      last = last.slice(0, i);
      validateMetadata(meta);
    }
    if (last.includes('-')) {
      const i = last.indexOf('-');
      pre = last.slice(i + 1);
      last = last.slice(0, i);
      validatePrerelease(pre);
    }
    parts[2] = last;
    for (const p of parts) {
      if (!containsOnly(p, NUM)) throw new ParseError('invalid characters in version');
      if (p.length > 1 && p[0] === '0') throw new ParseError('version segment starts with 0');
    }
    return new Version(parseUint(parts[0] as string), parseUint(parts[1] as string), parseUint(last), pre, meta, v);
  }

  /** True when `Version.parse` accepts the string. */
  static isValid(v: string): boolean {
    try {
      Version.parse(v);
      return true;
    } catch {
      return false;
    }
  }

  /** MAJOR.MINOR.PATCH[-pre][+meta], without the `v` prefix. */
  toString(): string {
    let s = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease !== '') s += `-${this.prerelease}`;
    if (this.metadata !== '') s += `+${this.metadata}`;
    return s;
  }

  /** Returns -1, 0 or 1. Metadata is ignored; a prerelease sorts below its release. */
  compare(o: Version): number {
    return (
      cmpBig(this.major, o.major) ||
      cmpBig(this.minor, o.minor) ||
      cmpBig(this.patch, o.patch) ||
      this.comparePre(o)
    );
  }

  private comparePre(o: Version): number {
    const ps = this.prerelease;
    const po = o.prerelease;
    if (ps === '' && po === '') return 0;
    if (ps === '') return 1;
    if (po === '') return -1;
    return comparePrerelease(ps, po);
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

/** Sorts ascending. The sort is stable; Go's `sort.Sort` is not, so equal versions may differ in order. */
export function sortVersions(versions: readonly (Version | string)[]): Version[] {
  return stableSort(
    versions.map((v) => (typeof v === 'string' ? Version.parse(v) : v)),
    (a, b) => a.lessThan(b),
  );
}

// ---------------------------------------------------------------------------
// Constraints

const CV =
  'v?([0-9|xX\\*]+)(\\.[0-9|xX\\*]+)?(\\.[0-9|xX\\*]+)?' +
  '(-([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?' +
  '(\\+([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?';
const OPS = '=||!=|>|<|>=|=>|<=|=<|~|~>|\\^';

const constraintRe = new RegExp(`^${S}*(${OPS})${S}*(${CV})${S}*$`);
const rangeRe = new RegExp(`${S}*(${CV})${S}+-${S}+(${CV})${S}*`, 'g');
const findRe = new RegExp(`(${OPS})${S}*(${CV})`, 'g');
// Go's RE2 runs this check in linear time; a backtracking engine does not, and the pattern
// Masterminds writes has overlapping whitespace groups that go exponential on input such as
// "1   1   1   ...!". This is the same language with the whitespace ownership made unambiguous:
// the space between two constraints belongs to the separator, never to a following empty operator.
const CV_PLAIN =
  'v?[0-9|xX\\*]+(?:\\.[0-9|xX\\*]+)?(?:\\.[0-9|xX\\*]+)?' +
  '(?:-[0-9A-Za-z\\-]+(?:\\.[0-9A-Za-z\\-]+)*)?' +
  '(?:\\+[0-9A-Za-z\\-]+(?:\\.[0-9A-Za-z\\-]+)*)?';
const OPS_NONEMPTY = '(?:=|!=|>|<|>=|=>|<=|=<|~|~>|\\^)';
const ITEM = `(?:${OPS_NONEMPTY}${S}*)?${CV_PLAIN}`;
const validRe = new RegExp(`^${S}*${ITEM}(?:(?:${S}+|${S}*,${S}*)${ITEM})*${S}*$`);

/** Exposed for the test suite only: the AND-segment validity pattern. Not part of the API. */
export const _segmentRe: RegExp = validRe;

interface Constraint {
  con: Version;
  orig: string;
  op: string;
  minorDirty: boolean;
  patchDirty: boolean;
  dirty: boolean;
}

const isX = (x: string): boolean => x === 'x' || x === '*' || x === 'X';

function parseConstraint(c: string): Constraint {
  if (c.length === 0) {
    return { con: Version.parseStrict('0.0.0'), orig: c, op: '', minorDirty: false, patchDirty: false, dirty: true };
  }
  const m = constraintRe.exec(c);
  if (m === null) throw new ParseError(`improper constraint: ${goQuote(c)}`);
  const g = (i: number): string => m[i] ?? '';
  let ver = g(2);
  let minorDirty = false;
  let patchDirty = false;
  let dirty = false;
  if (isX(g(3)) || g(3) === '') {
    ver = `0.0.0${g(6)}`;
    dirty = true;
  } else if (isX(g(4).replace(/^\./, '')) || g(4) === '') {
    minorDirty = true;
    dirty = true;
    ver = `${g(3)}.0.0${g(6)}`;
  } else if (isX(g(5).replace(/^\./, '')) || g(5) === '') {
    dirty = true;
    patchDirty = true;
    ver = `${g(3)}${g(4)}.0${g(6)}`;
  }
  let con: Version;
  try {
    con = Version.parse(ver);
  } catch {
    throw new ParseError('constraint parser error');
  }
  return { con, orig: g(2), op: g(1), minorDirty, patchDirty, dirty };
}

/** null means the version passes. A string is the reason it fails ('' when reasons are not wanted). */
type Verdict = string | null;

function preReason(v: Version): string {
  return `${goQuote(v.toString())} is a prerelease version and the constraint is only looking for release versions`;
}

function check(v: Version, c: Constraint, includePre: boolean, why: boolean): Verdict {
  if (v.prerelease !== '' && !includePre) return why ? preReason(v) : '';
  const fail = (f: () => string): Verdict => (why ? f() : '');
  const q = (x: string): string => goQuote(x);
  const vs = (): string => q(v.toString());
  const os = (): string => q(c.orig);
  switch (c.op) {
    case '!=':
      return notEqual(v, c, why);
    case '>':
      return greaterThan(v, c, why);
    case '<':
      return v.compare(c.con) < 0 ? null : fail(() => `${vs()} is greater than or equal to ${os()}`);
    case '>=':
    case '=>':
      return v.compare(c.con) >= 0 ? null : fail(() => `${vs()} is less than ${os()}`);
    case '<=':
    case '=<':
      return lessThanEqual(v, c, why);
    case '~':
    case '~>':
      return tilde(v, c, why);
    case '^':
      return caret(v, c, why);
    default: // '' and '='
      if (c.dirty) return tilde(v, c, why);
      return v.equal(c.con) ? null : fail(() => `${vs()} is not equal to ${os()}`);
  }
}

function notEqual(v: Version, c: Constraint, why: boolean): Verdict {
  const eqMsg = (): string => (why ? `${goQuote(v.toString())} is equal to ${goQuote(c.orig)}` : '');
  if (c.dirty) {
    if (c.con.major !== v.major) return null;
    if (c.con.minor !== v.minor && !c.minorDirty) return null;
    else if (c.minorDirty) return eqMsg();
    else if (c.con.patch !== v.patch && !c.patchDirty) return null;
    else if (c.patchDirty) {
      if (v.prerelease !== '' || c.con.prerelease !== '') {
        return comparePrerelease(v.prerelease, c.con.prerelease) !== 0 ? null : eqMsg();
      }
      return eqMsg();
    }
  }
  return v.equal(c.con) ? eqMsg() : null;
}

function greaterThan(v: Version, c: Constraint, why: boolean): Verdict {
  const fail = (): string => (why ? `${goQuote(v.toString())} is less than or equal to ${goQuote(c.orig)}` : '');
  if (!c.dirty) return v.compare(c.con) === 1 ? null : fail();
  if (v.major > c.con.major) return null;
  if (v.major < c.con.major) return fail();
  if (c.minorDirty) return fail();
  if (c.patchDirty) return v.minor > c.con.minor ? null : fail();
  return v.compare(c.con) === 1 ? null : fail();
}

function lessThanEqual(v: Version, c: Constraint, why: boolean): Verdict {
  const fail = (): string => (why ? `${goQuote(v.toString())} is greater than ${goQuote(c.orig)}` : '');
  if (!c.dirty) return v.compare(c.con) <= 0 ? null : fail();
  if (v.major > c.con.major) return fail();
  if (v.major === c.con.major && v.minor > c.con.minor && !c.minorDirty) return fail();
  return null;
}

function tilde(v: Version, c: Constraint, why: boolean): Verdict {
  const q = (x: string): string => goQuote(x);
  if (v.lessThan(c.con)) return why ? `${q(v.toString())} is less than ${q(c.orig)}` : '';
  if (c.con.major === 0n && c.con.minor === 0n && c.con.patch === 0n && !c.minorDirty && !c.patchDirty) return null;
  if (v.major !== c.con.major) {
    return why ? `${q(v.toString())} does not have same major version as ${q(c.orig)}` : '';
  }
  if (v.minor !== c.con.minor && !c.minorDirty) {
    return why ? `${q(v.toString())} does not have same major and minor version as ${q(c.orig)}` : '';
  }
  return null;
}

function caret(v: Version, c: Constraint, why: boolean): Verdict {
  const q = (x: string): string => goQuote(x);
  const vs = (): string => q(v.toString());
  const os = (): string => q(c.orig);
  if (v.lessThan(c.con)) return why ? `${vs()} is less than ${os()}` : '';
  if (c.con.major > 0n || c.minorDirty) {
    return v.major === c.con.major ? null : why ? `${vs()} does not have same major version as ${os()}` : '';
  }
  if (c.con.major === 0n && v.major > 0n) return why ? `${vs()} does not have same major version as ${os()}` : '';
  if (c.con.minor > 0n || c.patchDirty) {
    if (v.minor === c.con.minor) return null;
    return why
      ? `${vs()} does not have same minor version as ${os()}. Expected minor versions to match when constraint major version is 0`
      : '';
  }
  if (c.con.minor === 0n && v.minor > 0n) return why ? `${vs()} does not have same minor version as ${os()}` : '';
  if (c.con.patch === v.patch) return null;
  return why
    ? `${vs()} does not equal ${os()}. Expect version and constraint to equal when major and minor versions are 0`
    : '';
}

function rewriteRange(input: string): string {
  let o = input;
  for (const m of input.matchAll(rangeRe)) {
    const t = `>= ${m[1]}, <= ${m[11]} `;
    const i = o.indexOf(m[0]);
    if (i >= 0) o = o.slice(0, i) + t + o.slice(i + m[0].length);
  }
  return o;
}

/** Result of `Constraints.validate`: `reasons` lists why a check failed, in Go's order and wording. */
export interface Validation {
  ok: boolean;
  reasons: string[];
}

/** A parsed constraint expression: AND groups joined by `||`. */
export class Constraints {
  /** Match prereleases even when no constraint in the AND group names one. */
  includePrerelease: boolean;
  private readonly groups: Constraint[][];
  private readonly containsPre: boolean[];

  private constructor(groups: Constraint[][], containsPre: boolean[], includePrerelease: boolean) {
    this.groups = groups;
    this.containsPre = containsPre;
    this.includePrerelease = includePrerelease;
  }

  /** Go's `NewConstraint`. */
  static parse(input: string, options: { includePrerelease?: boolean } = {}): Constraints {
    if (byteLength(input) > MAX_CONSTRAINT_LEN) {
      throw new ParseError(`constraint string is too long (max ${MAX_CONSTRAINT_LEN} bytes)`);
    }
    const ors = rewriteRange(input).split('||');
    if (ors.length > MAX_CONSTRAINT_GROUPS) {
      throw new ParseError(`too many constraint groups (max ${MAX_CONSTRAINT_GROUPS})`);
    }
    const groups: Constraint[][] = [];
    const hasPre: boolean[] = [];
    ors.forEach((seg, k) => {
      if (!validRe.test(seg)) throw new ParseError(`improper constraint: ${goQuote(seg)}`);
      let parts = Array.from(seg.matchAll(findRe), (m) => m[0]);
      if (parts.length === 0) parts = [seg];
      hasPre[k] = false;
      groups[k] = parts.map((s) => {
        const pc = parseConstraint(s);
        if (pc.con.prerelease !== '') hasPre[k] = true;
        return pc;
      });
    });
    return new Constraints(groups, hasPre, options.includePrerelease ?? false);
  }

  /** True when `Constraints.parse` accepts the string. */
  static isValid(input: string): boolean {
    try {
      Constraints.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  /** Go's `Constraints.Check`. */
  check(v: Version | string): boolean {
    const ver = typeof v === 'string' ? Version.parse(v) : v;
    return this.groups.some((g, i) => {
      const inc = this.includePrerelease || (this.containsPre[i] as boolean);
      return g.every((c) => check(ver, c, inc, false) === null);
    });
  }

  /** Go's `Constraints.Validate`: the verdict plus the reasons for a failure. */
  validate(v: Version | string): Validation {
    const ver = typeof v === 'string' ? Version.parse(v) : v;
    const reasons: string[] = [];
    let preSeen = false;
    for (let i = 0; i < this.groups.length; i++) {
      let joy = true;
      const inc = this.includePrerelease || (this.containsPre[i] as boolean);
      for (const c of this.groups[i] as Constraint[]) {
        if (!this.includePrerelease && !this.containsPre[i] && ver.prerelease !== '') {
          if (!preSeen) {
            reasons.push(preReason(ver));
            preSeen = true;
          }
          joy = false;
        } else {
          const r = check(ver, c, inc, true);
          if (r !== null) {
            reasons.push(r);
            joy = false;
          }
        }
      }
      if (joy) return { ok: true, reasons: [] };
    }
    return { ok: false, reasons };
  }

  /** Canonical form: operators kept as written, AND joined by a space, OR by ` || `. */
  toString(): string {
    return this.groups.map((g) => g.map((c) => c.op + c.orig).join(' ')).join(' || ');
  }
}

/** Parses both arguments and checks the version against the constraint. Throws ParseError on bad input. */
export function satisfies(version: string, constraint: string, options: { includePrerelease?: boolean } = {}): boolean {
  return Constraints.parse(constraint, options).check(Version.parse(version));
}
