# rolldown-rollup-compat

> Yes, this is vibe-coded and WIP.

Seeded differential module-graph tests for Rolldown and Rollup compatibility.

This project generates deterministic ESM fixture graphs, builds each fixture with both Rollup and
Rolldown, executes the generated ESM entry chunk, and compares the exported primitive values. It is
intended for finding small, reproducible compatibility gaps in module loading, re-exporting,
dynamic imports, side effects, and chunk generation behavior.

## What It Tests

The fixed fixture families are inspired by module-loader stress cases:

- `dense-star`: dense `export *` graphs with shadowed exports
- `fanout-chain`: wide fan-out onto a long import chain
- `cyclic-reexport`: cyclic named re-exports

The fuzzer can combine these module path kinds:

- `static`: named static imports
- `namespace`: namespace imports
- `dynamic`: top-level dynamic imports
- `default`: default imports
- `named-reexport`: named re-exports
- `star-reexport`: star re-exports
- `side-effect`: side-effect-only imports

## Requirements

This repo uses Vite+, exposed through the global `vp` CLI. Vite+ manages the runtime, package
manager, checks, tests, and packaging commands for this project.

Install dependencies before working:

```bash
vp install
```

## Common Commands

Run the smoke differential suite:

```bash
vp run diff:smoke
```

Run fixed-family fixtures across a deterministic seed window:

```bash
vp run diff -- --family all --seed 0 --seeds 10
```

Run seeded fuzzing:

```bash
vp run diff:fuzz
```

Restrict fuzzing to specific path kinds:

```bash
vp run diff -- --fuzz --seed 1234 --cases 20 --paths static,dynamic,star-reexport
```

Write failing fixtures, result metadata, and REPL repro links:

```bash
vp run diff -- \
  --fuzz \
  --seed 1234 \
  --cases 50 \
  --max-width 6 \
  --max-depth 8 \
  --paths all \
  --out-dir failures \
  --report failures/report.jsonl
```

Run local validation:

```bash
vp check
vp test
```

Build the package:

```bash
vp pack
```

## CLI Options

```text
--family <name>      all | dense-star | fanout-chain | cyclic-reexport | fuzz
--fuzz               Alias for --family fuzz
--seed <number>      Base seed
--seeds <count>      Number of fixed-family seeds to run
--cases <count>      Number of fuzz cases to run when --family fuzz is active
--max-width <count>  Fuzz graph maximum modules per layer
--max-depth <count>  Fuzz graph maximum layer count
--paths <list>       Comma-separated path kinds, or all
--out-dir <dir>      Write failing generated fixtures and result metadata
--report <file>      Append one JSON object per case to a JSONL report
--continue-on-fail   Keep running after differences
--stop-on-fail       Stop after the first difference
```

## Failure Reproduction

The most reliable reproduction is always the generated fixture written by `--out-dir`. Each failed
fixture directory contains the generated source files, `result.json`, and `REPRO.md`.

`result.json` includes both bundler outcomes, normalized exports, differences, and REPL link
metadata. `REPRO.md` includes Rollup and Rolldown REPL links when the encoded URL is short enough
to be usable. Large fixtures keep the local files as the canonical repro and omit oversized links.

The REPL links are useful for triage and issue reports, but they should not replace the local repro:
online REPLs run browser-hosted bundler builds and can drift from the exact package versions used
in CI.

## REPL URL Contracts

The project pins hashes for the upstream files that define Rollup and Rolldown REPL URL state. This
keeps generated links honest: if either REPL changes its URL format, CI can detect the mismatch and
prompt an update to the local encoder.

Check the pinned contracts:

```bash
vp run check:repl-contract
```

When this check fails, inspect the upstream change, update `src/repl.ts` if the URL state format
changed, and then update the pinned hashes in `replContractSources`.

## CI Strategy

Use fast checks on pull requests and larger scheduled runs for fuzzing.

For pull requests and pushes:

```bash
vp install
vp check
vp test
vp run diff:smoke
```

For hourly scheduled fuzzing, use a deterministic seed window based on the CI run number:

```bash
BASE_SEED=$((GITHUB_RUN_NUMBER * 1000))

vp run diff -- \
  --fuzz \
  --seed "$BASE_SEED" \
  --cases 250 \
  --max-width 6 \
  --max-depth 8 \
  --paths all \
  --out-dir artifacts/failures \
  --report artifacts/report.jsonl
```

For nightly runs, increase `--cases`, `--max-width`, or `--max-depth` after measuring runtime.

Upload the `artifacts` directory even when the job fails so that failing fixture files, `result.json`,
`REPRO.md`, and JSONL reports are available for debugging.

## Library API

The package exports fixture generation, fuzzing, differential execution, REPL link generation, and
REPL contract checking helpers from `src/index.ts`.

Common entry points:

- `createFixture`
- `createAllFixtures`
- `createFuzzFixture`
- `runCompatFixture`
- `writeFixture`
- `createReplLinks`
- `checkReplContracts`

## Development Notes

- Fixture generation should remain deterministic for a given seed and option set.
- Keep generated fixtures small enough to minimize and share, then scale coverage by running more
  seeds in CI.
- Prefer local repro fixtures for correctness, and REPL links for communication.
- Run `vp check` and `vp test` before sending changes.
