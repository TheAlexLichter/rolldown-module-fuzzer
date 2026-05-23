import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import type { ModuleFixture } from "./fixtures.ts";

const execFileAsync = promisify(execFile);
const executeGeneratedTimeoutMs = 10_000;

export interface SerializableNamespace {
  [name: string]: null | number | string | boolean;
}

export interface ChunkSummary {
  fileName: string;
  imports: string[];
  dynamicImports: string[];
  exports: string[];
  isEntry: boolean;
  isDynamicEntry: boolean;
}

export interface BuildOk {
  status: "ok";
  warnings: string[];
  exports: SerializableNamespace;
  chunks: ChunkSummary[];
}

export interface BuildError {
  status: "error";
  warnings: string[];
  error: string;
}

export type BuildOutcome = BuildOk | BuildError;

export interface CompatResult {
  fixture: string;
  rollup: BuildOutcome;
  rolldown: BuildOutcome;
  options: CompatOptions;
  matches: boolean;
  differences: string[];
}

export interface CompatOptions {
  rolldownStrictExecutionOrder: boolean;
}

export async function runCompatFixture(
  fixture: ModuleFixture,
  options: Partial<CompatOptions> = {},
): Promise<CompatResult> {
  const normalizedOptions = normalizeCompatOptions(options);
  const root = await mkdtemp(join(tmpdir(), "rolldown-rollup-compat-"));

  try {
    await writeFixture(root, fixture);

    const [rollupOutcome, rolldownOutcome] = await Promise.all([
      buildWithRollup(root, fixture.entry),
      buildWithRolldown(root, fixture.entry, normalizedOptions),
    ]);
    const differences = compareOutcomes(rollupOutcome, rolldownOutcome);

    return {
      fixture: fixture.name,
      rollup: rollupOutcome,
      rolldown: rolldownOutcome,
      options: normalizedOptions,
      matches: differences.length === 0,
      differences,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function normalizeCompatOptions(options: Partial<CompatOptions>): CompatOptions {
  return {
    rolldownStrictExecutionOrder: options.rolldownStrictExecutionOrder ?? false,
  };
}

export async function writeFixture(root: string, fixture: ModuleFixture) {
  for (const file of fixture.files) {
    const fullPath = join(root, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.source);
  }
}

async function buildWithRollup(root: string, entry: string): Promise<BuildOutcome> {
  const warnings: string[] = [];
  let bundle: Awaited<ReturnType<typeof rollup>> | undefined;

  try {
    bundle = await rollup({
      input: join(root, entry),
      onwarn(warning) {
        warnings.push(formatWarning(warning));
      },
      treeshake: true,
    });
    const generated = await bundle.generate({
      dir: root,
      entryFileNames: "[name].rollup.js",
      format: "esm",
    });

    return {
      status: "ok",
      warnings,
      exports: await executeGenerated(root, generated.output),
      chunks: summarizeChunks(generated.output),
    };
  } catch (error) {
    return { status: "error", warnings, error: formatError(error) };
  } finally {
    await bundle?.close();
  }
}

async function buildWithRolldown(
  root: string,
  entry: string,
  options: CompatOptions,
): Promise<BuildOutcome> {
  const warnings: string[] = [];
  let bundle: Awaited<ReturnType<typeof rolldown>> | undefined;

  try {
    bundle = await rolldown({
      input: join(root, entry),
      onwarn(warning) {
        warnings.push(formatWarning(warning));
      },
      treeshake: true,
    });
    const generated = await bundle.generate({
      dir: root,
      entryFileNames: "[name].rolldown.js",
      format: "esm",
      strictExecutionOrder: options.rolldownStrictExecutionOrder,
    });

    return {
      status: "ok",
      warnings,
      exports: await executeGenerated(root, generated.output),
      chunks: summarizeChunks(generated.output),
    };
  } catch (error) {
    return { status: "error", warnings, error: formatError(error) };
  } finally {
    await bundle?.close();
  }
}

async function executeGenerated(root: string, output: readonly GeneratedOutput[]) {
  for (const item of output) {
    const source = "source" in item ? item.source : item.code;
    if (typeof source !== "string") continue;

    const fullPath = join(root, item.fileName);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, source);
  }

  const entry = output.find((item) => "code" in item && item.isEntry);
  if (!entry) throw new Error("Generated output did not contain an entry chunk");

  const resultPath = join(root, `${entry.fileName}.exports.json`);
  const runnerPath = join(root, `${entry.fileName}.runner.mjs`);
  await writeFile(runnerPath, createExecutionRunner());
  await execFileAsync(
    process.execPath,
    [runnerPath, pathToFileURL(join(root, entry.fileName)).href, resultPath],
    {
      timeout: executeGeneratedTimeoutMs,
    },
  );

  return JSON.parse(await readFile(resultPath, "utf8")) as SerializableNamespace;
}

function summarizeChunks(output: readonly GeneratedOutput[]): ChunkSummary[] {
  return output
    .filter((item): item is GeneratedChunk => "code" in item)
    .map((chunk) => ({
      fileName: chunk.fileName,
      imports: [...chunk.imports].sort(),
      dynamicImports: [...chunk.dynamicImports].sort(),
      exports: [...chunk.exports].sort(),
      isEntry: chunk.isEntry,
      isDynamicEntry: chunk.isDynamicEntry,
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function compareOutcomes(rollupOutcome: BuildOutcome, rolldownOutcome: BuildOutcome): string[] {
  const differences: string[] = [];

  if (rollupOutcome.status !== rolldownOutcome.status) {
    differences.push(
      `status mismatch: rollup=${rollupOutcome.status}, rolldown=${rolldownOutcome.status}`,
    );
    return differences;
  }

  if (rollupOutcome.status === "error" && rolldownOutcome.status === "error") return differences;

  if (rollupOutcome.status === "ok" && rolldownOutcome.status === "ok") {
    const rollupExports = stableJson(rollupOutcome.exports);
    const rolldownExports = stableJson(rolldownOutcome.exports);

    if (rollupExports !== rolldownExports)
      differences.push(`export mismatch: rollup=${rollupExports}, rolldown=${rolldownExports}`);
  }

  return differences;
}

function stableJson(value: unknown) {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function formatWarning(warning: unknown) {
  if (typeof warning === "string") return warning;

  if (warning && typeof warning === "object" && "message" in warning)
    return String(warning.message);

  return String(warning);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;

  return String(error);
}

function createExecutionRunner() {
  return `import { writeFile } from "node:fs/promises";

const [entryUrl, resultPath] = process.argv.slice(2);
globalThis.__compatLog = [];
const namespace = await import(entryUrl);
const serialized = {};

for (const key of Object.keys(namespace).sort()) {
  const value = namespace[key];

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    serialized[key] = value;
  }
}

await writeFile(resultPath, JSON.stringify(serialized));
`;
}

type GeneratedOutput = {
  fileName: string;
  source?: string | Uint8Array;
  code?: string;
  imports?: string[];
  dynamicImports?: string[];
  exports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
};

type GeneratedChunk = Required<
  Pick<GeneratedOutput, "code" | "dynamicImports" | "exports" | "fileName" | "imports">
> & {
  isDynamicEntry: boolean;
  isEntry: boolean;
};
