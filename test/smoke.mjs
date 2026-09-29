/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines`. The TypeScript suite needs type stripping and only runs on 24+.
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

const root = await import('../dist/index.js');
const mm = await import('../dist/masterminds.js');
const hc = await import('../dist/hashicorp.js');

function load(name) {
  const url = new URL(`./fixtures/${name}.jsonl.gz`, import.meta.url);
  return gunzipSync(readFileSync(url)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('root and subpath exports are the same modules', () => {
  assert.equal(root.masterminds.Version, mm.Version);
  assert.equal(root.hashicorp.Constraints, hc.Constraints);
  assert.equal(typeof root.ParseError, 'function');
});

test('masterminds: dist agrees with the Go fixture', () => {
  const recs = load('masterminds');
  const pool = [];
  let checked = 0;
  for (const r of recs) {
    if (r.t === 'version') {
      let v = null;
      try {
        v = mm.Version.parse(r.v);
      } catch (e) {
        assert.equal(r.ok, false, r.v);
        assert.equal(e.message, r.err);
      }
      if (v) assert.equal(v.toString(), r.str);
      pool.push(v);
    } else if (r.t === 'constraint') {
      let c = null;
      try {
        c = mm.Constraints.parse(r.c);
      } catch (e) {
        assert.equal(r.ok, false, r.c);
        assert.equal(e.message, r.err);
        continue;
      }
      assert.equal(r.ok, true, r.c);
      assert.equal(c.toString(), r.str);
      r.vi.forEach((i, j) => {
        if (pool[i] === null) return;
        assert.equal(c.check(pool[i]) ? '1' : '0', r.chk[j], `${r.c} vs ${pool[i].original}`);
        assert.equal(c.validate(pool[i]).reasons.join('\n'), r.val[j]);
        checked++;
      });
    }
  }
  assert.ok(checked > 50000);
});

test('hashicorp: dist agrees with the Go fixture', () => {
  const recs = load('hashicorp');
  const pool = [];
  let checked = 0;
  for (const r of recs) {
    if (r.t === 'version') {
      let v = null;
      try {
        v = hc.Version.parse(r.v);
      } catch (e) {
        assert.equal(r.ok, false, r.v);
        assert.equal(e.message, r.err);
      }
      if (v) assert.equal(v.toString(), r.str);
      pool.push(v);
    } else if (r.t === 'constraint') {
      let c = null;
      try {
        c = hc.Constraints.parse(r.c);
      } catch (e) {
        assert.equal(r.ok, false, r.c);
        assert.equal(e.message, r.err);
        continue;
      }
      assert.equal(r.ok, true, r.c);
      assert.equal(c.toString(), r.str);
      assert.equal(c.sort().toString(), r.srt);
      r.vi.forEach((i, j) => {
        if (pool[i] === null) return;
        assert.equal(c.check(pool[i]) ? '1' : '0', r.chk[j], `${r.c} vs ${pool[i].original}`);
        checked++;
      });
    }
  }
  assert.ok(checked > 50000);
});

test('examples from the README', () => {
  assert.equal(mm.satisfies('1.2.5', '~1.2.3'), true);
  assert.equal(hc.satisfies('1.9.0', '~> 1.2'), true);
  assert.equal(hc.satisfies('1.3.0', '~> 1.2.0'), false);
});
