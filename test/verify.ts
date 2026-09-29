import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { hashicorp, masterminds } from '../src/index.ts';

export interface Rec {
  t: string;
  [k: string]: unknown;
}

export function load(path: string): Rec[] {
  const text = gunzipSync(readFileSync(path)).toString('utf8');
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Rec);
}

export interface Report {
  dialect: string;
  counts: Record<string, number>;
  mismatches: string[];
}

type Parse<V> = (s: string) => V;

function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try {
    return { ok: true, v: f() };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
}

/** Compares every record in a corpus to this implementation and lists disagreements. */
export function verify(dialect: 'masterminds' | 'hashicorp', recs: Rec[]): Report {
  const rep: Report = { dialect, counts: {}, mismatches: [] };
  const bump = (k: string): void => {
    rep.counts[k] = (rep.counts[k] ?? 0) + 1;
  };
  const bad = (msg: string): void => {
    if (rep.mismatches.length < 50) rep.mismatches.push(msg);
    bump('mismatch');
  };
  const eq = (what: string, input: unknown, got: unknown, want: unknown): void => {
    if (got !== want) bad(`${what} ${JSON.stringify(input)}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  const isM = dialect === 'masterminds';
  const M = masterminds;
  const H = hashicorp;
  // Version and Constraints are looked up per dialect; the two share no base type.
  type AnyV = InstanceType<typeof M.Version> | InstanceType<typeof H.Version>;
  const parseV: Parse<AnyV> = isM ? M.Version.parse : H.Version.parse;
  const strictV: Parse<AnyV> = isM ? M.Version.parseStrict : H.Version.parseSemver;
  const pool: (AnyV | null)[] = [];

  for (const r of recs) {
    bump(r.t);
    if (r.t === 'version') {
      const s = r.v as string;
      const p = attempt(() => parseV(s));
      eq('version.ok', s, p.ok, r.ok);
      if (p.ok) {
        pool.push(p.v);
        if (r.ok) {
          eq('version.str', s, p.v.toString(), r.str);
          eq('version.orig', s, p.v.original, r.orig);
          eq('version.pre', s, p.v.prerelease, r.pre);
          eq('version.meta', s, p.v.metadata, r.meta);
          if (isM) {
            const v = p.v as InstanceType<typeof M.Version>;
            eq('version.parts', s, `${v.major}.${v.minor}.${v.patch}`, `${r.maj}.${r.min}.${r.pat}`);
          } else {
            const v = p.v as InstanceType<typeof H.Version>;
            eq('version.seg', s, v.segments.join(','), (r.seg as string[]).join(','));
            eq('version.core', s, v.core().toString(), r.core);
          }
        }
      } else {
        pool.push(null);
        eq('version.err', s, p.err, r.err);
      }
      const sp = attempt(() => strictV(s));
      eq('version.strict.ok', s, sp.ok, r.sok);
      if (sp.ok && r.sok) {
        eq('version.strict.str', s, sp.v.toString(), r.sstr);
        if (isM) eq('version.strict.orig', s, sp.v.original, r.sorig);
      }
      if (!sp.ok && !r.sok) eq('version.strict.err', s, sp.err, r.serr);
    } else if (r.t === 'constraint') {
      const c = r.c as string;
      const p = attempt(() => (isM ? M.Constraints.parse(c) : H.Constraints.parse(c)));
      eq('constraint.ok', c, p.ok, r.ok);
      if (!p.ok) {
        if (!r.ok) eq('constraint.err', c, p.err, r.err);
        continue;
      }
      if (!r.ok) continue;
      eq('constraint.str', c, p.v.toString(), r.str);
      const vi = r.vi as number[];
      const chk = r.chk as string;
      vi.forEach((idx, j) => {
        const v = pool[idx] ?? null;
        const want = chk[j] as string;
        if (v === null) {
          eq('pool.invalid', c, want, 'x');
          return;
        }
        if (isM) {
          const cs = p.v as ReturnType<typeof M.Constraints.parse>;
          const mv = v as InstanceType<typeof M.Version>;
          const tag = `${c} vs ${mv.original}`;
          eq('check', tag, cs.check(mv) ? '1' : '0', want);
          const val = cs.validate(mv);
          const wantVal = (r.val as string[])[j] as string;
          eq('validate', tag, val.reasons.join('\n'), wantVal);
          eq('validate.ok', tag, val.ok, wantVal === '');
          cs.includePrerelease = true;
          eq('check.inc', tag, cs.check(mv) ? '1' : '0', (r.inc as string)[j]);
          eq('validate.inc', tag, cs.validate(mv).reasons.join('\n'), (r.ival as string[])[j]);
          cs.includePrerelease = false;
        } else {
          const cs = p.v as ReturnType<typeof H.Constraints.parse>;
          const hvv = v as InstanceType<typeof H.Version>;
          eq('check', `${c} vs ${hvv.original}`, cs.check(hvv) ? '1' : '0', want);
        }
      });
      if (!isM) eq('constraint.sort', c, (p.v as ReturnType<typeof H.Constraints.parse>).sort().toString(), r.srt);
    } else if (r.t === 'cmp') {
      const a = pool[r.a as number] as AnyV;
      const b = pool[r.b as number] as AnyV;
      const tag = `${a.original} <=> ${b.original}`;
      eq('compare', tag, (a as InstanceType<typeof M.Version>).compare(b as InstanceType<typeof M.Version>), r.r);
      eq('equal', tag, (a as InstanceType<typeof M.Version>).equal(b as InstanceType<typeof M.Version>), r.eq);
    } else if (r.t === 'sort') {
      const inn = (r.in as number[]).map((i) => pool[i] as AnyV);
      const sorted = (isM ? M.sortVersions(inn as never) : H.sortVersions(inn as never)) as AnyV[];
      // Map back to indexes by identity.
      const got = sorted.map((v) => (r.in as number[])[inn.indexOf(v)]);
      eq('sort', (r.in as number[]).join(','), got.join(','), (r.out as number[]).join(','));
    }
  }
  return rep;
}
