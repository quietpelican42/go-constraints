# go-constraints

Version constraints for Node that behave like Go's Masterminds/semver (Helm) and hashicorp/go-version (Terraform, Packer, Nomad), checked against both libraries.

```ts
import { masterminds, hashicorp } from 'go-constraints';

masterminds.satisfies('1.2.5', '~1.2.3');          // true   (Helm chart dependency style)
masterminds.satisfies('1.4.0', '>=1.2.3, <2.0.0'); // true   (comma or space is AND)
hashicorp.satisfies('1.9.0', '~> 1.2');            // true   (Terraform required_version style)
hashicorp.satisfies('1.3.0', '~> 1.2.0');          // false  (one more segment, narrower range)
```

## Why

Helm charts and many Go tools use Masterminds/semver constraints. Terraform, Packer and Nomad use hashicorp/go-version constraints. Both differ from npm's `semver` ranges: comma-separated AND, `!=`, `~>`, `=<`, `=>`, four-segment versions and different prerelease rules. Tools written in Node either reject these strings or hand-roll a converter. Renovate converts HashiCorp constraints to npm ranges in `lib/modules/versioning/hashicorp/convertor.ts`, whose comment says the `!=` syntax "is currently unsupported", and its `helm` versioning reuses the npm module.

Measured: `npm install --no-save semver && npm run build && npm run bench`

```
semver 7.8.5, loose mode on
masterminds: 20000 constraints, 14268 valid in Go
  npm semver  parse accept/reject agreement 64.28%, full agreement 45.63%, Go-valid rejected 2826
  go-constraints full agreement 100.00%
hashicorp: 20000 constraints, 16934 valid in Go
  npm semver  parse accept/reject agreement 63.23%, full agreement 41.15%, Go-valid rejected 6162
  go-constraints full agreement 100.00%
```

Full agreement means the constraint is accepted or rejected as Go does and every pool version that parses gets the same result as Go's `Check`. The fixture is deliberately edge-heavy (mutated strings, oversized numbers, odd whitespace), so the percentages describe that corpus, not real-world manifests. npm `semver` was used in loose mode, which favors it. No other npm package was found that implements either dialect: searches for `masterminds*`, `hashicorp-version*`, `go-version*`, `helm-semver*`, `tf-constraint*` and `terraform-constraint*` returned nothing relevant.

## Installation

```sh
npm install go-constraints
```

Node 20.6 or later. No runtime dependencies. The package is ESM. Subpath imports `go-constraints/masterminds` and `go-constraints/hashicorp` are available.

## Usage

### Masterminds (Helm)

```ts
import { masterminds } from 'go-constraints';

const c = masterminds.Constraints.parse('^1.2.3 || >=3.0.0-beta.1 <3.1.0');
c.check('1.9.0');            // true
c.check('3.0.0-beta.2');     // true  (the constraint names a prerelease on 3.0.0)
c.validate('0.9.0');         // { ok: false, reasons: ['"0.9.0" is less than "1.2.3"', '"0.9.0" is less than "3.0.0-beta.1"'] }
c.toString();                // '^1.2.3 || >=3.0.0-beta.1 <3.1.0'

masterminds.Constraints.parse('>=1.2.0').check('1.3.0-beta');                            // false
masterminds.Constraints.parse('>=1.2.0', { includePrerelease: true }).check('1.3.0-beta'); // true
masterminds.Constraints.parse('1.2.3 - 2.3.4').toString();                                // '>=1.2.3 <=2.3.4'
```

### go-version (Terraform)

```ts
import { hashicorp } from 'go-constraints';

const c = hashicorp.Constraints.parse('>= 1.0, < 2.0, != 1.5.0');
c.check('1.4.0');                       // true
hashicorp.Version.parse('v1.2').toString();      // '1.2.0'
hashicorp.Version.parse('1.2.3.4').segments;     // [1n, 2n, 3n, 4n]
hashicorp.sortVersions(['1.10', '1.2', '1.2-beta']).map(String); // ['1.2.0-beta', '1.2.0', '1.10.0']
```

### Errors

Parse failures throw `ParseError`. The message is the text the Go library returns, including Go's `%q` quoting, for example `improper constraint: ">= foo"` or `malformed constraint: ~> foo`.

## Reference

Both modules export `Version`, `Constraints`, `sortVersions` and `satisfies`. `ParseError` is exported from the root.

### masterminds

| Name | Description |
| --- | --- |
| `Version.parse(s)` | Go's `NewVersion`. Accepts `v` prefix and missing minor or patch. |
| `Version.parseStrict(s)` | Go's `StrictNewVersion`. Exactly `MAJOR.MINOR.PATCH`, no `v`, no leading zeros. |
| `Version.isValid(s)` | True when `parse` accepts `s`. |
| `version.major`, `.minor`, `.patch` | `bigint` (unsigned 64-bit). |
| `version.prerelease`, `.metadata`, `.original` | Strings. `original` is the input unchanged. |
| `version.toString()` | Canonical form without the `v` prefix. |
| `version.compare(o)`, `.equal`, `.lessThan`, `.greaterThan` | Metadata is ignored. |
| `Constraints.parse(s, { includePrerelease })` | Go's `NewConstraint`. Operators `= != > < >= => <= =< ~ ~> ^`, wildcards `x X *`, hyphen ranges, `,` or space for AND, `||` for OR. |
| `Constraints.isValid(s)` | True when `parse` accepts `s`. |
| `constraints.check(v)` | `v` is a `Version` or a string. |
| `constraints.validate(v)` | `{ ok, reasons }` with Go's reason strings. |
| `constraints.includePrerelease` | Mutable. Matches prereleases even when no constraint names one. |
| `constraints.toString()` | Canonical form. |
| `sortVersions(list)` | New array, ascending, stable. |
| `satisfies(version, constraint, options?)` | Parses both and checks. |

### hashicorp

| Name | Description |
| --- | --- |
| `Version.parse(s)` | Go's `NewVersion`. Optional `v`, any number of segments, prerelease with or without a hyphen. |
| `Version.parseSemver(s)` | Go's `NewSemver`. A prerelease needs its hyphen. |
| `version.segments` | `bigint[]` (signed 64-bit), padded to at least three. |
| `version.written` | Number of segments in the source string. |
| `version.prerelease`, `.metadata`, `.original` | Strings. |
| `version.core()` | The first three segments as a new `Version`. |
| `version.compare(o)`, `.equal`, `.lessThan`, `.greaterThan` | Missing trailing segments count as zero. |
| `Constraints.parse(s)` | Go's `NewConstraint`. Comma-separated `= != > < >= <= ~>` (no operator means `=`). |
| `constraints.check(v)` | `v` is a `Version` or a string. |
| `constraints.sort()` | Copy ordered by operator, then version. |
| `constraints.toString()` | Each piece as written, joined by `,`. |
| `sortVersions(list)` | New array, ascending. |
| `satisfies(version, constraints)` | Parses both and checks. |

## How it works

Both modules follow the behavior of the Go libraries and were checked against them with a differential corpus. `tools/oracle` is a Go program that generates constraints and versions (with mutations), runs the real libraries and records accept/reject, error text, `String()`, `Original()`, `Check`, `Validate`, `Compare` and sort results. `test/fixtures` holds a generated corpus of 20,000 constraints and 600 versions per dialect, with 2,400 comparisons and 3,000 sorts. See `test/fixtures/README.txt` for the record format.

The Masterminds module is a port of Masterminds/semver v3.5.0 and keeps its regular expressions, uint64 segments (as `bigint`) and error messages. One pattern is rewritten: Masterminds' whole-segment validity regex has overlapping whitespace groups that backtrack exponentially in JavaScript's engine, where Go's engine is linear. The replacement accepts the same language with unambiguous whitespace, verified exhaustively for all strings up to six characters over a nine-character alphabet and against the corpus.

The go-version module is a reimplementation from documented behavior and from differential runs against the library. It is not a port, because go-version is MPL-2.0, which is file-level copyleft. No go-version source is copied.

`~>` in go-version depends on how many segments were written. `~> 1.2` allows `>= 1.2, < 2.0`. `~> 1.2.0` allows `>= 1.2.0, < 1.3.0`. A prerelease version matches an ordering operator only when the constraint names a prerelease with the same numeric segments.

## Limitations

- Sorting is stable. Go's `sort.Sort` is not, so equal versions (differing only in metadata) may come out in a different order. Up to 20 elements the order matches Go's stable sort exactly, including for go-version's comparison, which is not always antisymmetric. Above 20 elements the built-in stable sort is used, so inputs that hit that inconsistency may differ from Go.
- The Go regexp `\s` and `\d` are ASCII-only. The port uses explicit ASCII classes. `%q` quoting uses Unicode properties from the running Node and can differ from Go for characters added to Unicode recently.
- go-version has no length limit. A run of thousands of hyphens in one version takes tens of milliseconds and grows faster than linearly.
- Masterminds' `IncludePrerelease` is supported. Its `CoerceNewVersion = false` mode and `Inc*`/`Set*` methods are not.
- Only Masterminds v3.5.0 and go-version v1.9.0 were compared. Other releases may differ.
- go-version's `Constraints.Equals`, `WithPrefix` and JSON/SQL hooks are not implemented.

## Compatibility

Run here: Node 24.20.0 (TypeScript suite and built `dist`), Go 1.27.1 for the oracle. CI is configured for Node 20.6, 22 and 24 against `dist`; those runs have not been made.

## Development

```sh
npm install
npx tsc --noEmit
npm test                     # fixture, unit and live Go tests
npm run build && npm run test:dist
```

`test/live.test.ts` runs `go run` on `tools/oracle` with fresh seeds and skips loudly when `go` is missing. Set `GO_LIVE_SEEDS=1,2,3` to pin seeds. To regenerate the fixture:

```sh
cd tools/oracle && go run . gen -out ../../test/fixtures -seed 20260929 -n 20000 -pool 600
shasum -a 256 ../../test/fixtures/*.jsonl.gz > ../../test/fixtures/SHA256SUMS
```

## License

MIT. See [LICENSE](LICENSE). The Masterminds port carries its notice in [LICENSE-masterminds-semver](LICENSE-masterminds-semver).
