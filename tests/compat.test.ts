import { describe, expect, test } from "vite-plus/test";
import { createFuzzFixture } from "../src/fuzzer.ts";
import { createAllFixtures, createFixture } from "../src/fixtures.ts";
import { runCompatFixture } from "../src/diff.ts";

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
