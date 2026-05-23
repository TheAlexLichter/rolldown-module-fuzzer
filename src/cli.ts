import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createAllFixtures, createFixture, type FixtureFamily } from "./fixtures.ts";
import { normalizeModulePathKinds, type FuzzFixtureOptions } from "./fuzzer.ts";
import { allModulePathKinds } from "./module-helpers.ts";
import { createReplLinks, type ReplLinks } from "./repl.ts";
import { runCompatFixture, writeFixture, type CompatResult } from "./diff.ts";
import type { ModuleFixture } from "./fixtures.ts";

const families: FixtureFamily[] = ["dense-star", "fanout-chain", "cyclic-reexport", "fuzz"];
const packageJson = readPackageJson();

interface CliOptions {
  family: FixtureFamily | "all";
  seed: number;
  seeds: number;
  cases: number;
  continueOnFail: boolean;
  fuzz: Omit<FuzzFixtureOptions, "seed">;
  outDir?: string;
  report?: string;
}

const options = parseArgs(process.argv.slice(2));
const fixtures = Array.from(
  { length: options.family === "fuzz" ? options.cases : options.seeds },
  (_, index) => {
    const seed = options.seed + index;

    if (options.family === "all") return createAllFixtures(seed);

    return [createFixture({ family: options.family, seed, fuzz: options.fuzz })];
  },
).flat();

let failed = false;

for (const fixture of fixtures) {
  const result = await runCompatFixture(fixture);
  const replLinks = result.matches ? undefined : createFailureReplLinks(fixture);
  const prefix = result.matches ? "ok" : "fail";

  console.log(`${prefix} ${result.fixture}`);

  if (!result.matches) {
    failed = true;
    for (const difference of result.differences) console.log(`  ${difference}`);
    printReplLinks(replLinks);

    if (options.outDir) {
      const fixtureDir = join(options.outDir, result.fixture);
      await writeFailure(fixtureDir, fixture, result, replLinks);
      console.log(`  wrote fixture to ${fixtureDir}`);
    }
  }

  if (options.report) await appendReportLine(options.report, { ...result, repl: replLinks });

  if (!result.matches && !options.continueOnFail) break;
}

if (failed) process.exitCode = 1;

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    family: "all",
    seed: 0,
    seeds: 1,
    cases: 1,
    continueOnFail: true,
    fuzz: {
      maxWidth: 4,
      maxDepth: 4,
      paths: allModulePathKinds,
    },
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--") continue;

    if (arg === "--family") {
      const family = args[++index];
      if (!isFamily(family) && family !== "all")
        throw new Error(`Unknown family "${family}". Expected one of: all, ${families.join(", ")}`);
      options.family = family;
      continue;
    }

    if (arg === "--fuzz") {
      options.family = "fuzz";
      continue;
    }

    if (arg === "--seed") {
      options.seed = parsePositiveInteger(args[++index], "--seed", { allowZero: true });
      continue;
    }

    if (arg === "--seeds") {
      options.seeds = parsePositiveInteger(args[++index], "--seeds");
      continue;
    }

    if (arg === "--cases") {
      options.cases = parsePositiveInteger(args[++index], "--cases");
      continue;
    }

    if (arg === "--max-width") {
      options.fuzz.maxWidth = parsePositiveInteger(args[++index], "--max-width");
      continue;
    }

    if (arg === "--max-depth") {
      options.fuzz.maxDepth = parsePositiveInteger(args[++index], "--max-depth");
      continue;
    }

    if (arg === "--paths") {
      options.fuzz.paths = normalizeModulePathKinds(args[++index]);
      continue;
    }

    if (arg === "--continue-on-fail") {
      options.continueOnFail = true;
      continue;
    }

    if (arg === "--stop-on-fail") {
      options.continueOnFail = false;
      continue;
    }

    if (arg === "--out-dir") {
      options.outDir = args[++index];
      if (!options.outDir) throw new Error("--out-dir requires a directory");
      continue;
    }

    if (arg === "--report") {
      options.report = args[++index];
      if (!options.report) throw new Error("--report requires a file path");
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  return options;
}

async function writeFailure(
  fixtureDir: string,
  fixture: ModuleFixture,
  result: CompatResult,
  replLinks: ReplLinks | undefined,
) {
  await writeFixture(fixtureDir, fixture);
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    `${fixtureDir}/result.json`,
    `${JSON.stringify({ ...result, repl: replLinks }, null, 2)}\n`,
  );
  await writeFile(`${fixtureDir}/REPRO.md`, createReproMarkdown(result, replLinks));
}

async function appendReportLine(reportPath: string, result: CompatResult & { repl?: ReplLinks }) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result)}\n`, { flag: "a" });
}

function parsePositiveInteger(
  value: string | undefined,
  flag: string,
  options: { allowZero?: boolean } = {},
) {
  const parsed = Number(value);
  const min = options.allowZero ? 0 : 1;

  if (!Number.isInteger(parsed) || parsed < min)
    throw new Error(`${flag} must be an integer >= ${min}`);

  return parsed;
}

function isFamily(value: string | undefined): value is FixtureFamily {
  return families.includes(value as FixtureFamily);
}

function printHelp() {
  console.log(`Usage: vp run diff -- [options]

Options:
  --family <name>      all | ${families.join(" | ")} (default: all)
  --fuzz               Alias for --family fuzz
  --seed <number>      Base seed (default: 0)
  --seeds <count>      Number of deterministic fixed-family seeds to run (default: 1)
  --cases <count>      Number of fuzz cases to run when --family fuzz is active (default: 1)
  --max-width <count>  Fuzz graph maximum modules per layer (default: 4)
  --max-depth <count>  Fuzz graph maximum layer count (default: 4)
  --paths <list>       Comma-separated fuzz paths, or "all" (default: all)
  --out-dir <dir>      Write failing generated fixtures and result metadata
  --report <file>      Append one JSON object per case to a JSONL report
  --continue-on-fail   Keep running after differences (default)
  --stop-on-fail       Stop after the first difference

Path kinds:
  ${allModulePathKinds.join(", ")}
`);
}

function createFailureReplLinks(fixture: ModuleFixture) {
  return createReplLinks(fixture, {
    rollupVersion: packageVersion("rollup"),
    rolldownVersion: packageVersion("rolldown"),
  });
}

function printReplLinks(replLinks: ReplLinks | undefined) {
  if (!replLinks) return;

  printReplLink("rollup", replLinks.rollup);
  printReplLink("rolldown", replLinks.rolldown);
}

function printReplLink(name: string, link: ReplLinks["rollup"]) {
  if (link.status === "ok") {
    console.log(`  ${name} repl: ${link.url}`);
    return;
  }

  console.log(`  ${name} repl: omitted (${link.reason})`);
}

function createReproMarkdown(result: CompatResult, replLinks: ReplLinks | undefined) {
  const lines = [
    `# ${result.fixture}`,
    "",
    "## Result",
    "",
    ...result.differences.map((difference) => `- ${difference}`),
    "",
    "## Online REPLs",
    "",
    formatMarkdownReplLink("Rollup", replLinks?.rollup),
    formatMarkdownReplLink("Rolldown", replLinks?.rolldown),
    "",
    "The local fixture files in this directory are the canonical reproduction. The REPLs use the",
    "browser-hosted bundler builds and are intended for triage and issue reports.",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatMarkdownReplLink(label: string, link: ReplLinks["rollup"] | undefined) {
  if (!link) return `- ${label}: unavailable`;
  if (link.status === "ok") return `- ${label}: ${link.url}`;

  return `- ${label}: omitted (${link.reason})`;
}

function packageVersion(name: "rolldown" | "rollup") {
  return (
    packageJson.inlinedDependencies?.[name] ??
    packageJson.devDependencies?.[name]?.replace(/^[^\d]*/, "")
  );
}

function readPackageJson() {
  const require = createRequire(import.meta.url);

  return require("../package.json") as {
    devDependencies?: Partial<Record<"rolldown" | "rollup", string>>;
    inlinedDependencies?: Partial<Record<"rolldown" | "rollup", string>>;
  };
}
