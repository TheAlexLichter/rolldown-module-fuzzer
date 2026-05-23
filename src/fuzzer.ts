import {
  ModuleBuilder,
  allModulePathKinds,
  relativeSpecifier,
  type ModulePathKind,
} from "./module-helpers.ts";
import { Rng } from "./rng.ts";
import type { FixtureFile, ModuleFixture } from "./fixtures.ts";

export interface FuzzFixtureOptions {
  seed: number;
  maxWidth: number;
  maxDepth: number;
  paths?: readonly ModulePathKind[];
}

interface GraphNode {
  id: number;
  depth: number;
  path: string;
  valueExport: string;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  kind: ModulePathKind;
}

export function createFuzzFixture(options: FuzzFixtureOptions): ModuleFixture {
  const normalized = normalizeFuzzOptions(options);
  const rng = new Rng(normalized.seed);
  const nodes = createNodes(rng, normalized.maxWidth, normalized.maxDepth);
  const edges = createEdges(rng, nodes, normalized.paths);
  const files = createFiles(normalized.seed, nodes, edges);

  files.push(createEntryFile(nodes, normalized.seed, normalized.paths));

  return {
    name: `fuzz-${normalized.seed}-w${normalized.maxWidth}-d${normalized.maxDepth}-${normalized.paths.join("+")}`,
    entry: "entry.js",
    files,
  };
}

export function normalizeModulePathKinds(value: string | undefined): ModulePathKind[] {
  if (!value || value === "all") return allModulePathKinds;

  const paths = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const path of paths) {
    if (!isModulePathKind(path))
      throw new Error(
        `Unknown path kind "${path}". Expected one of: all, ${allModulePathKinds.join(", ")}`,
      );
  }

  return [...new Set(paths)] as ModulePathKind[];
}

function normalizeFuzzOptions(options: FuzzFixtureOptions): Required<FuzzFixtureOptions> {
  if (!Number.isInteger(options.seed)) throw new Error("seed must be an integer");

  if (!Number.isInteger(options.maxWidth) || options.maxWidth < 1)
    throw new Error("maxWidth must be a positive integer");

  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1)
    throw new Error("maxDepth must be a positive integer");

  return {
    seed: options.seed,
    maxWidth: options.maxWidth,
    maxDepth: options.maxDepth,
    paths: options.paths?.length ? [...options.paths] : allModulePathKinds,
  };
}

function createNodes(rng: Rng, maxWidth: number, maxDepth: number): GraphNode[] {
  const nodes: GraphNode[] = [];
  let id = 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    const width = rng.integer(1, maxWidth);

    for (let index = 0; index < width; index++) {
      nodes.push({
        id,
        depth,
        path: `d${depth}/m${id}.js`,
        valueExport: `v${id}`,
      });
      id++;
    }
  }

  return nodes;
}

function createEdges(rng: Rng, nodes: GraphNode[], paths: readonly ModulePathKind[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const byDepth = groupByDepth(nodes);

  for (const from of nodes) {
    const candidates = nodes.filter((node) => node.depth > from.depth);
    if (candidates.length === 0) continue;

    const maxEdges = Math.min(candidates.length, 1 + rng.integer(0, 2));
    const selected = rng.sample(candidates, maxEdges);

    for (const to of selected) {
      const kind = rng.choice(paths);
      edges.push({ from, to, kind });
    }

    if (from.depth + 1 < byDepth.size && !edges.some((edge) => edge.from === from)) {
      const nextLayer = byDepth.get(from.depth + 1);
      if (nextLayer?.length)
        edges.push({ from, to: rng.choice(nextLayer), kind: rng.choice(paths) });
    }
  }

  return edges;
}

function createFiles(
  seed: number,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): FixtureFile[] {
  return nodes.map((node) => {
    const builder = new ModuleBuilder({
      id: node.id,
      path: node.path,
      seed,
      includeSideEffect: edges.some((edge) => edge.to === node && edge.kind === "side-effect"),
    });
    const outgoing = edges.filter((edge) => edge.from === node);

    for (const [index, edge] of outgoing.entries()) {
      const specifier = relativeSpecifier(node.path, edge.to.path);
      const exportName = `r${edge.to.id}_${index}`;

      if (edge.kind === "default") {
        builder.addDefaultImport(specifier, exportName);
        continue;
      }

      if (edge.kind === "dynamic") {
        builder.addDynamicImport(specifier, edge.to.valueExport, exportName);
        continue;
      }

      if (edge.kind === "named-reexport") {
        builder.addNamedReexport(specifier, edge.to.valueExport, exportName);
        continue;
      }

      if (edge.kind === "namespace") {
        builder.addNamespaceImport(specifier, edge.to.valueExport, exportName);
        continue;
      }

      if (edge.kind === "side-effect") {
        builder.addSideEffectImport(specifier);
        continue;
      }

      if (edge.kind === "star-reexport") {
        builder.addStarReexport(specifier);
        continue;
      }

      builder.addStaticImport(specifier, edge.to.valueExport, exportName);
    }

    const built = builder.build();
    return {
      path: built.path,
      source: built.source,
    };
  });
}

function createEntryFile(
  nodes: readonly GraphNode[],
  seed: number,
  paths: readonly ModulePathKind[],
): FixtureFile {
  const rootNodes = nodes.filter((node) => node.depth === 0);
  const imports: string[] = [];
  const terms: string[] = [];

  for (const [index, node] of rootNodes.entries()) {
    const specifier = relativeSpecifier("entry.js", node.path);

    if (paths.includes("namespace") && index % 3 === 1) {
      const local = `rootNs${index}`;
      imports.push(`import * as ${local} from '${specifier}';`);
      terms.push(`${local}.${node.valueExport}`);
      continue;
    }

    if (paths.includes("default") && index % 3 === 2) {
      const local = `rootDefault${index}`;
      imports.push(`import ${local} from '${specifier}';`);
      terms.push(local);
      continue;
    }

    const local = `rootValue${index}`;
    imports.push(`import { ${node.valueExport} as ${local} } from '${specifier}';`);
    terms.push(local);
  }

  const dynamicRoot = rootNodes.at(-1);
  if (dynamicRoot && paths.includes("dynamic")) {
    imports.push(
      `const dynamicRoot = await import('${relativeSpecifier("entry.js", dynamicRoot.path)}');`,
    );
    terms.push(`dynamicRoot.${dynamicRoot.valueExport}`);
  }

  return {
    path: "entry.js",
    source: [
      "globalThis.__compatLog ??= [];",
      ...imports,
      `export const result = [${terms.join(", ")}].join('|') + ':${seed}';`,
      "export const sideEffects = globalThis.__compatLog.join(',');",
      "",
    ].join("\n"),
  };
}

function groupByDepth(nodes: readonly GraphNode[]) {
  const byDepth = new Map<number, GraphNode[]>();

  for (const node of nodes) {
    const layer = byDepth.get(node.depth);

    if (layer) layer.push(node);
    else byDepth.set(node.depth, [node]);
  }

  return byDepth;
}

function isModulePathKind(value: string): value is ModulePathKind {
  return allModulePathKinds.includes(value as ModulePathKind);
}
