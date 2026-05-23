import { describe, expect, test } from "vite-plus/test";
import { createFuzzFixture } from "../src/fuzzer.ts";
import { createAllFixtures, createFixture } from "../src/fixtures.ts";
import { runCompatFixture } from "../src/diff.ts";
import { createGithubAnnotations, detectDefaultReporterFormat } from "../src/reporters.ts";
import {
  createReplLinks,
  decodeRolldownHashState,
  decodeRollupShareableState,
  replContractSources,
} from "../src/repl.ts";

describe("fixture generation", () => {
  test("is deterministic for the same seed", () => {
    expect(createFixture({ family: "dense-star", seed: 2 })).toEqual(
      createFixture({ family: "dense-star", seed: 2 }),
    );
  });

  test("creates all initial graph families", () => {
    expect(createAllFixtures(0).map((fixture) => fixture.name)).toEqual([
      "dense-star-0",
      "fanout-chain-0",
      "cyclic-reexport-0",
    ]);
  });

  test("creates deterministic fuzz fixtures", () => {
    const options = {
      seed: 42,
      maxWidth: 3,
      maxDepth: 4,
      paths: ["static", "dynamic", "namespace"] as const,
    };

    expect(createFuzzFixture(options)).toEqual(createFuzzFixture(options));
  });

  test("can add cycle back-edges to fuzz fixtures", () => {
    const fixture = createFuzzFixture({
      seed: 0,
      maxWidth: 1,
      maxDepth: 2,
      cycles: true,
      paths: ["star-reexport"],
    });
    const leaf = fixture.files.find((file) => file.path === "d1/m1.js");

    expect(fixture.name).toContain("-cycles-");
    expect(leaf?.source).toContain("export * from '../d0/m0.js';");
  });

  test("can keep fuzz fixtures acyclic", () => {
    const fixture = createFuzzFixture({
      seed: 0,
      maxWidth: 1,
      maxDepth: 2,
      cycles: false,
      paths: ["star-reexport"],
    });
    const leaf = fixture.files.find((file) => file.path === "d1/m1.js");

    expect(fixture.name).toContain("-dag-");
    expect(leaf?.source).not.toContain("export * from '../d0/m0.js';");
  });
});

describe("rollup and rolldown compatibility", () => {
  for (const fixture of [
    ...createAllFixtures(0),
    createFuzzFixture({
      seed: 42,
      maxWidth: 3,
      maxDepth: 4,
      paths: ["static", "dynamic", "namespace", "default", "named-reexport", "star-reexport"],
    }),
  ]) {
    test(fixture.name, async () => {
      const result = await runCompatFixture(fixture);

      expect(result.differences).toEqual([]);
      expect(result.matches).toBe(true);
    });
  }
});

describe("repl links", () => {
  test("creates decodable Rollup and Rolldown links", () => {
    const fixture = createFixture({ family: "dense-star", seed: 0 });
    const links = createReplLinks(fixture, {
      rollupVersion: "4.60.4",
      rolldownVersion: "1.0.2",
    });

    expect(links.rollup.status).toBe("ok");
    expect(links.rolldown.status).toBe("ok");

    if (links.rollup.status !== "ok" || links.rolldown.status !== "ok") return;

    const rollupUrl = new URL(links.rollup.url);
    const rollupState = decodeRollupShareableState(rollupUrl.searchParams.get("shareable")!);
    expect(rollupState.modules.map((module) => module.name)).toEqual(
      fixture.files.map((file) => file.path),
    );
    expect(rollupState.modules.find((module) => module.isEntry)?.name).toBe(fixture.entry);

    const rolldownState = decodeRolldownHashState(links.rolldown.url.split("#")[1]!);
    expect(Object.keys(rolldownState.f)).toEqual(fixture.files.map((file) => file.path));
    expect(Object.values(rolldownState.f).find((file) => file.e)?.n).toBe(fixture.entry);
  });

  test("adds a Rolldown REPL config for strict execution order", () => {
    const fixture = createFixture({ family: "dense-star", seed: 0 });
    const links = createReplLinks(fixture, {
      rolldownStrictExecutionOrder: true,
    });

    expect(links.rolldown.status).toBe("ok");
    if (links.rolldown.status !== "ok") return;

    const rolldownState = decodeRolldownHashState(links.rolldown.url.split("#")[1]!);
    expect(rolldownState.f["rolldown.config.ts"]?.c).toContain("strictExecutionOrder: true");
    expect(rolldownState.f["rolldown.config.ts"]?.e).toBe(false);
  });

  test("pins upstream URL-state contracts", () => {
    expect(replContractSources.map((source) => source.name)).toEqual([
      "rollup-query-state",
      "rolldown-url-state",
      "rolldown-url-codec",
      "rolldown-source-file-json",
    ]);
  });
});

describe("reporters", () => {
  test("auto-detects the GitHub Actions reporter", () => {
    expect(detectDefaultReporterFormat({ GITHUB_ACTIONS: "true" })).toBe("github");
    expect(detectDefaultReporterFormat({ GITHUB_ACTIONS: "false" })).toBe("text");
    expect(detectDefaultReporterFormat({})).toBe("text");
  });

  test("formats GitHub Actions warnings and errors", () => {
    const annotations = createGithubAnnotations(
      {
        fixture: "dense,star:0",
        rollup: {
          status: "ok",
          warnings: ["rollup warning with percent %\nand newline"],
          exports: {},
          chunks: [],
        },
        rolldown: {
          status: "error",
          warnings: [],
          error: "rolldown failed",
        },
        options: {
          rolldownStrictExecutionOrder: false,
        },
        matches: false,
        differences: ["status mismatch: rollup=ok, rolldown=error"],
      },
      {
        command: "vp run diff -- --seed 1",
      },
      {
        reproPath: "artifacts/failures/dense,star:0/REPRO.md",
      },
    );

    expect(annotations).toHaveLength(3);
    expect(annotations[0]).toContain("::warning title=Rollup warning%3A dense%2Cstar%3A0::");
    expect(annotations[0]).toContain("percent %25%0Aand newline");
    expect(annotations[1]).toContain(
      "::error file=artifacts/failures/dense%2Cstar%3A0/REPRO.md,title=Compat mismatch%3A dense%2Cstar%3A0::",
    );
    expect(annotations[1]).toContain("status mismatch: rollup=ok, rolldown=error");
    expect(annotations[2]).toContain("title=Rolldown build error%3A dense%2Cstar%3A0");
  });
});
