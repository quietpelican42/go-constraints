import assert from 'node:assert/strict';
import test from 'node:test';
import { ParseError, hashicorp, masterminds } from '../src/index.ts';

test('masterminds: version parsing and canonical form', () => {
  const v = masterminds.Version.parse('v1.2');
  assert.equal(v.toString(), '1.2.0');
  assert.equal(v.original, 'v1.2');
  assert.equal(masterminds.Version.parse('1.2.3-rc.1+b.5').toString(), '1.2.3-rc.1+b.5');
  assert.throws(() => masterminds.Version.parseStrict('1.2'), ParseError);
  assert.throws(() => masterminds.Version.parse('1.2.3.4'), /invalid semantic version/);
  assert.throws(() => masterminds.Version.parse('1.2.3-01'), /version segment starts with 0/);
  assert.equal(masterminds.Version.parse('18446744073709551615').major, 18446744073709551615n);
  assert.throws(() => masterminds.Version.parse('18446744073709551616'), /value out of range/);
});

test('masterminds: constraints', () => {
  const s = masterminds.satisfies;
  assert.ok(s('1.2.5', '~1.2.3'));
  assert.ok(!s('1.3.0', '~1.2.3'));
  assert.ok(s('1.9.0', '^1.2.3'));
  assert.ok(!s('0.3.0', '^0.2.3'));
  assert.ok(s('1.5.0', '>=1.2.3, <2.0.0'));
  assert.ok(s('1.5.0', '>=1.2.3 <2.0.0'));
  assert.ok(s('3.0.0', '1.x || >=3'));
  assert.ok(s('1.4.0', '1.2.3 - 2.0.0'));
  assert.ok(!s('1.2.4', '!=1.2.x'));
  assert.equal(masterminds.Constraints.parse('1.2.3 - 2.3.4').toString(), '>=1.2.3 <=2.3.4');
  assert.equal(masterminds.Constraints.parse('~> 1.2 , != 1.2.5').toString(), '~>1.2 !=1.2.5');
});

test('masterminds: prerelease rule and includePrerelease', () => {
  assert.ok(!masterminds.satisfies('1.3.0-beta', '>=1.2.0'));
  assert.ok(masterminds.satisfies('1.3.0-beta', '>=1.2.0', { includePrerelease: true }));
  assert.ok(masterminds.satisfies('1.2.3-beta.2', '>=1.2.3-beta.1'));
  const c = masterminds.Constraints.parse('>=1.2.0');
  const r = c.validate('1.3.0-beta');
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [
    '"1.3.0-beta" is a prerelease version and the constraint is only looking for release versions',
  ]);
  assert.deepEqual(c.validate('1.1.0').reasons, ['"1.1.0" is less than "1.2.0"']);
});

test('masterminds: parse errors use Go wording', () => {
  assert.throws(() => masterminds.Constraints.parse('>= foo'), /improper constraint: ">= foo"/);
  assert.throws(() => masterminds.Constraints.parse('a\tb'), /improper constraint: "a\\tb"/);
  assert.throws(() => masterminds.Constraints.parse('x'.repeat(513)), /too long/);
  assert.equal(masterminds.Constraints.isValid(''), false);
});

test('masterminds: sort', () => {
  const out = masterminds.sortVersions(['1.10.0', '1.2.0', 'v1.2.0-rc.1', '1.2.0-rc.10', '1.2.0-rc.2']);
  assert.deepEqual(
    out.map((v) => v.original),
    ['v1.2.0-rc.1', '1.2.0-rc.2', '1.2.0-rc.10', '1.2.0', '1.10.0'],
  );
});

test('hashicorp: versions', () => {
  const v = hashicorp.Version.parse('v1.2.3.4-beta1+meta');
  assert.equal(v.toString(), '1.2.3.4-beta1+meta');
  assert.deepEqual(v.segments, [1n, 2n, 3n, 4n]);
  assert.equal(hashicorp.Version.parse('1.0').toString(), '1.0.0');
  assert.equal(hashicorp.Version.parse('1.0beta').prerelease, 'beta');
  assert.throws(() => hashicorp.Version.parseSemver('1.0beta'), /malformed version: 1.0beta/);
  assert.equal(hashicorp.Version.parse('1.0').equal(hashicorp.Version.parse('1.0.0')), true);
  assert.equal(hashicorp.Version.parse('1.2.3.4').core().toString(), '1.2.3');
});

test('hashicorp: pessimistic operator depends on how many segments were written', () => {
  const s = hashicorp.satisfies;
  assert.ok(s('1.9.0', '~> 1.2'));
  assert.ok(!s('2.0.0', '~> 1.2'));
  assert.ok(s('1.2.9', '~> 1.2.0'));
  assert.ok(!s('1.3.0', '~> 1.2.0'));
  assert.ok(s('1.2.3.9', '~> 1.2.3.4'));
  assert.ok(!s('1.2.4', '~> 1.2.3.4'));
  assert.ok(s('9.0', '~> 1'));
});

test('hashicorp: constraints, prerelease rules and canonical form', () => {
  const s = hashicorp.satisfies;
  assert.ok(s('1.5.0', '>= 1.0, < 2.0'));
  assert.ok(!s('1.5.0-beta', '>= 1.0'));
  assert.ok(s('1.5.0-beta', '= 1.5.0-beta'));
  assert.ok(s('1.5.0-beta', '!= 1.5.0'));
  assert.ok(s('1.0.0-beta', '>= 1.0.0-alpha'));
  assert.ok(!s('1.0.1-beta', '>= 1.0.0-alpha'));
  // String() keeps each piece as written, whitespace included.
  assert.equal(hashicorp.Constraints.parse(' >= 1.0 , < 2 ').toString(), ' >= 1.0 , < 2 ');
  // Sorting orders by operator, then version.
  assert.equal(hashicorp.Constraints.parse('>= 1, = 3, < 2').sort().toString(), ' < 2, = 3,>= 1');
  assert.throws(() => hashicorp.Constraints.parse('>= 1.0,'), /malformed constraint: /);
  assert.throws(() => hashicorp.Constraints.parse('~> foo'), /malformed constraint: ~> foo/);
});

test('hashicorp: sort', () => {
  const out = hashicorp.sortVersions(['1.10', '1.2.0.1', '1.2', '1.2-beta', '1.2.0.0']);
  assert.deepEqual(
    out.map((v) => v.original),
    ['1.2-beta', '1.2', '1.2.0.0', '1.2.0.1', '1.10'],
  );
});
