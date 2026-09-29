import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load, verify } from './verify.ts';

const dir = new URL('./fixtures/', import.meta.url);

for (const dialect of ['masterminds', 'hashicorp'] as const) {
  test(`${dialect}: agrees with the Go fixture`, () => {
    const recs = load(new URL(`${dialect}.jsonl.gz`, dir).pathname);
    const rep = verify(dialect, recs);
    console.log(`${dialect}: ${JSON.stringify(rep.counts)}`);
    assert.deepEqual(rep.mismatches, []);
    assert.ok((rep.counts.constraint ?? 0) >= 20000);
  });
}

test('fixture files match SHA256SUMS', () => {
  const sums = readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n');
  assert.equal(sums.length, 2);
  for (const line of sums) {
    const [sum, name] = line.split(/\s+/) as [string, string];
    const actual = createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex');
    assert.equal(actual, sum, name);
  }
});

test('negative control: a corrupted fixture is reported', () => {
  for (const dialect of ['masterminds', 'hashicorp'] as const) {
    const recs = load(new URL(`${dialect}.jsonl.gz`, dir).pathname);
    const c = recs.find((r) => r.t === 'constraint' && r.ok === true && (r.chk as string).includes('1'));
    assert.ok(c);
    c.chk = (c.chk as string).replace('1', '0');
    const s = recs.find((r) => r.t === 'sort');
    assert.ok(s);
    (s.out as number[]).reverse();
    const rep = verify(dialect, recs);
    assert.ok(rep.mismatches.some((m) => m.startsWith('check ')), dialect);
    assert.ok(rep.mismatches.length >= 1);
  }
});
