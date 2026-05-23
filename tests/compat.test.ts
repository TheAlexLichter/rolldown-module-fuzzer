import { describe, expect, test } from "vite-plus/test";
import { createFuzzFixture } from "../src/fuzzer.ts";
import { createAllFixtures, createFixture } from "../src/fixtures.ts";
import { runCompatFixture } from "../src/diff.ts";
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

  test("pins upstream URL-state contracts", () => {
    expect(replContractSources.map((source) => source.name)).toEqual([
      "rollup-query-state",
      "rolldown-url-state",
      "rolldown-url-codec",
      "rolldown-source-file-json",
    ]);
  });
});
