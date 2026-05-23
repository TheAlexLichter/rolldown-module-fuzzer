# rolldown-rollup-compat

Seeded differential tests for Rolldown and Rollup module-graph compatibility.

The project starts with graph families inspired by WebKit/JSC module-loader stress cases:

- dense `export *` graphs
- wide fan-out onto a long import chain
- cyclic re-export graphs
- seeded fuzz graphs with static imports, namespace imports, dynamic imports, default imports, named re-exports, star re-exports, and side-effect imports

The harness writes a deterministic fixture to a temporary directory, builds it with Rollup and Rolldown, executes the generated ESM entry chunk, and compares the exported primitive values.

## Development

Install dependencies:

```bash
vp install
```

Run the smoke differential suite:

```bash
vp run diff:smoke
```

Run a larger seeded pass:

```bash
vp run diff -- --family all --seeds 10
```

Run seeded fuzzing:

```bash
vp run diff:fuzz
```

Restrict fuzzing to specific module graph paths:

```bash
vp run diff -- --fuzz --seed 1234 --cases 20 --paths static,dynamic,star-reexport
```

Write failing generated fixtures for repro:

```bash
vp run diff -- --fuzz --seed 1234 --cases 50 --max-width 6 --max-depth 8 --paths all --out-dir failures
```

Run checks and tests:

```bash
vp check
vp test
```

Build the library:

```bash
vp pack
```
