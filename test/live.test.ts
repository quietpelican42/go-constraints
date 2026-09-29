import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { load, verify } from './verify.ts';

// Seeds default to fresh values on every run so each run tests inputs the fixture never saw.
// Set GO_LIVE_SEEDS=1,2,3 to pin them. Each seed is 20000 constraints per dialect.
const seeds = (process.env.GO_LIVE_SEEDS ?? `${Date.now() % 1_000_000},${Math.floor(Date.now() / 8) % 1_000_000}`).split(',');
const oracle = new URL('../tools/oracle/', import.meta.url).pathname;

function skipLoudly(t: test.TestContext, why: string): void {
  const msg = `SKIPPED live Go differential test: ${why}`;
  process.stderr.write(`\n!!! ${msg}\n\n`);
  t.skip(msg);
}

test('live: agrees with Go on freshly generated inputs', { timeout: 300_000 }, (t) => {
  const probe = spawnSync('go', ['version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    return skipLoudly(t, 'the `go` toolchain is not on PATH. Install Go (https://go.dev/dl) and rerun `npm test`.');
  }
  const out = mkdtempSync(join(tmpdir(), 'go-constraints-'));
  try {
    for (const seed of seeds) {
      const run = spawnSync('go', ['run', '.', 'gen', '-out', out, '-seed', seed, '-n', '20000', '-pool', '600'], {
        cwd: oracle,
        encoding: 'utf8',
        timeout: 240_000,
      });
      if (run.status !== 0) {
        return skipLoudly(t, `\`go run\` failed (offline, or modules unavailable?): ${(run.stderr || String(run.error)).slice(0, 300)}`);
      }
      for (const dialect of ['masterminds', 'hashicorp'] as const) {
        const rep = verify(dialect, load(join(out, `${dialect}.jsonl.gz`)));
        console.log(`live seed ${seed} ${dialect}: ${JSON.stringify(rep.counts)}`);
        assert.deepEqual(rep.mismatches, [], `${dialect} seed ${seed}`);
        assert.ok((rep.counts.constraint ?? 0) >= 20000);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

