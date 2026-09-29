/**
 * Measures how often npm `semver` agrees with Go on the committed fixtures, and
 * how often this package does. Needs the incumbent installed without saving it:
 *
 *   npm install --no-save semver && npm run build && npm run bench
 *
 * A constraint agrees when it is accepted or rejected as Go does AND every
 * pool version that parses gets the same Check result.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

let semver;
try {
  semver = (await import('semver')).default;
} catch {
  console.error('SKIPPED: npm `semver` is not installed. Run: npm install --no-save semver');
  process.exit(0);
}
const mm = await import('../dist/masterminds.js');
const hc = await import('../dist/hashicorp.js');

const load = (name) =>
  gunzipSync(readFileSync(new URL(`../test/fixtures/${name}.jsonl.gz`, import.meta.url)))
    .toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function measure(name, ours, theirs) {
  const recs = load(name);
  const versions = recs.filter((r) => r.t === 'version');
  let n = 0, accept = 0, full = 0, ourFull = 0, goValid = 0, rejectedValid = 0;
  for (const r of recs) {
    if (r.t !== 'constraint') continue;
    n++;
    if (r.ok) goValid++;
    const agree = (impl) => {
      const c = impl.parse(r.c);
      if (c.error !== undefined) return { parse: !r.ok, all: !r.ok };
      if (!r.ok) return { parse: false, all: false };
      const all = r.vi.every((i, j) => {
        const v = versions[i];
        if (r.chk[j] === 'x') return true;
        return impl.check(c, v.v) === (r.chk[j] === '1');
      });
      return { parse: true, all };
    };
    const a = agree(theirs);
    if (a.parse) accept++;
    if (a.all) full++;
    if (r.ok && theirs.parse(r.c).error !== undefined) rejectedValid++;
    if (agree(ours).all) ourFull++;
  }
  const pct = (x) => ((100 * x) / n).toFixed(2) + '%';
  console.log(`${name}: ${n} constraints, ${goValid} valid in Go`);
  console.log(`  npm semver  parse accept/reject agreement ${pct(accept)}, full agreement ${pct(full)}, Go-valid rejected ${rejectedValid}`);
  console.log(`  go-constraints full agreement ${pct(ourFull)}`);
}

const npmImpl = {
  parse(c) {
    try { return { r: new semver.Range(c, { loose: true }) }; } catch (e) { return { error: e }; }
  },
  check(c, v) {
    try { return c.r.test(new semver.SemVer(v, { loose: true })); } catch { return false; }
  },
};
const wrap = (mod, C) => ({
  parse(c) { try { return { r: C.parse(c) }; } catch (e) { return { error: e }; } },
  check(c, v) { return c.r.check(v); },
});
console.log(`semver ${semver.SemVer ? JSON.parse(readFileSync(new URL('../node_modules/semver/package.json', import.meta.url))).version : '?'}, loose mode on`);
measure('masterminds', wrap(mm, mm.Constraints), npmImpl);
measure('hashicorp', wrap(hc, hc.Constraints), npmImpl);
