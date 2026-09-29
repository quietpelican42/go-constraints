import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { _segmentRe } from '../src/masterminds.ts';

// The pattern Masterminds ships, verbatim. It is only safe on short input under a backtracking engine.
const S = '[\\t\\n\\f\\r ]';
const CV =
  'v?([0-9|xX\\*]+)(\\.[0-9|xX\\*]+)?(\\.[0-9|xX\\*]+)?' +
  '(-([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?' +
  '(\\+([0-9A-Za-z\\-]+(\\.[0-9A-Za-z\\-]+)*))?';
const OPS = '=||!=|>|<|>=|=>|<=|=<|~|~>|\\^';
const goPattern = new RegExp(`^(${S}*(${OPS})${S}*(${CV})${S}*)((?:${S}+|,${S}*)(${OPS})${S}*(${CV})${S}*)*$`);

test('segment pattern accepts exactly what the original pattern accepts (exhaustive to length 6)', () => {
  const alphabet = [' ', ',', '1', 'x', '>', '=', '-', '.', '~'];
  let n = 0;
  const walk = (prefix: string, depth: number): void => {
    assert.equal(_segmentRe.test(prefix), goPattern.test(prefix), JSON.stringify(prefix));
    n++;
    if (depth === 0) return;
    for (const ch of alphabet) walk(prefix + ch, depth - 1);
  };
  walk('', 6);
  assert.ok(n > 500000);
});

test('adversarial inputs finish quickly', () => {
  const cases = [
    "m.Constraints.parse(('1' + ' '.repeat(3)).repeat(120) + '!')",
    "m.Constraints.parse('>1' + ' '.repeat(500) + '!')",
    "m.Constraints.parse(('>1 , ').repeat(80) + '!')",
    "m.Constraints.parse('1' + ' '.repeat(250) + '-' + ' '.repeat(250) + '!')",
    "h.Constraints.parse(('>= 1 , ').repeat(3000) + '!')",
    "h.Version.parse('1-' + 'a.'.repeat(3000) + '!')",
  ];
  for (const c of cases) {
    const code = `import { masterminds as m, hashicorp as h } from './src/index.ts'; try { ${c} } catch {}`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('..', import.meta.url).pathname,
      timeout: 10_000,
    });
    assert.equal(r.status, 0, `${c} timed out or failed: ${r.stderr}`);
  }
});
