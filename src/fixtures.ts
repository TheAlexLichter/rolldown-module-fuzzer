export interface FixtureFile {
  path: string;
  source: string;
}

export interface ModuleFixture {
  name: string;
  entry: string;
  files: FixtureFile[];
}

export interface GraphSeed {
  family: FixtureFamily;
  seed: number;
  fuzz?: Partial<Omit<FuzzFixtureOptions, "seed">>;
}

export type FixtureFamily = "cyclic-reexport" | "dense-star" | "fanout-chain" | "fuzz";

export function createFixture({ family, seed, fuzz }: GraphSeed): ModuleFixture {
  if (family === "fuzz")
    return createFuzzFixture({
      seed,
      maxWidth: fuzz?.maxWidth ?? 4,
      maxDepth: fuzz?.maxDepth ?? 4,
      cycles: fuzz?.cycles,
      formats: fuzz?.formats,
      paths: fuzz?.paths,
    });

  if (family === "dense-star") return createDenseStarFixture(seed);

  if (family === "fanout-chain") return createFanoutChainFixture(seed);

  return createCyclicReexportFixture(seed);
}

export function createAllFixtures(seed = 0): ModuleFixture[] {
  return [
    createFixture({ family: "dense-star", seed }),
    createFixture({ family: "fanout-chain", seed }),
    createFixture({ family: "cyclic-reexport", seed }),
  ];
}

export function createDenseStarFixture(seed = 0): ModuleFixture {
  const width = 4 + (seed % 3);
  const files: FixtureFile[] = [
    {
      path: "shared.js",
      source: "export const shared = 42;\nexport const shadowed = 'shared';\n",
    },
  ];

  for (let index = 0; index < width; index++) {
    const name = moduleName(index);
    const previous = index === 0 ? ["shared"] : ["shared", moduleName(index - 1)];
    const exports = previous.map((dependency) => `export * from './${dependency}.js';`).join("\n");

    files.push({
      path: `${name}.js`,
      source: `${exports}\nexport const ${name} = '${name}';\nexport const shadowed = '${name}';\n`,
    });
  }

  files.push({
    path: "entry.js",
    source: [
      `import * as ns from './${moduleName(width - 1)}.js';`,
      "export const result = [ns.shared, ns.m0, ns.m1, ns.shadowed].join('|');",
      "export const keys = Object.keys(ns).sort().join(',');",
      "",
    ].join("\n"),
  });

  return {
    name: `dense-star-${seed}`,
    entry: "entry.js",
    files,
  };
}

export function createFanoutChainFixture(seed = 0): ModuleFixture {
  const depth = 8 + (seed % 5);
  const files: FixtureFile[] = [];

  for (let index = 0; index <= depth; index++) {
    if (index === depth) {
      files.push({
        path: `a${index}.js`,
        source: `export const v${index} = ${index};\n`,
      });
      continue;
    }

    files.push({
      path: `a${index}.js`,
      source: `import { v${index + 1} } from './a${index + 1}.js';\nexport const v${index} = v${index + 1} + ${index};\n`,
    });
  }

  const imports = Array.from({ length: depth + 1 }, (_, index) => {
    return `import { v${index} } from './a${index}.js';`;
  }).join("\n");
  const values = Array.from({ length: depth + 1 }, (_, index) => `v${index}`).join(", ");

  files.push({
    path: "entry.js",
    source: `${imports}\nexport const result = [${values}].join('|');\n`,
  });

  return {
    name: `fanout-chain-${seed}`,
    entry: "entry.js",
    files,
  };
}

export function createCyclicReexportFixture(seed = 0): ModuleFixture {
  return {
    name: `cyclic-reexport-${seed}`,
    entry: "entry.js",
    files: [
      {
        path: "a.js",
        source: "export { b } from './b.js';\nexport const a = 'a';\n",
      },
      {
        path: "b.js",
        source: "export { a } from './a.js';\nexport const b = 'b';\n",
      },
      {
        path: "entry.js",
        source: [
          "import * as ns from './a.js';",
          `export const result = ns.a + ns.b + ':${seed % 10}';`,
          "export const keys = Object.keys(ns).sort().join(',');",
          "",
        ].join("\n"),
      },
    ],
  };
}

function moduleName(index: number) {
  return `m${index}`;
}
import { createFuzzFixture, type FuzzFixtureOptions } from "./fuzzer.ts";
