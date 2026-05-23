import { deflateSync, inflateSync } from "node:zlib";
import type { ModuleFixture } from "./fixtures.ts";

export interface ReplLink {
  status: "ok";
  url: string;
  length: number;
}

export interface OmittedReplLink {
  status: "omitted";
  reason: string;
  length: number;
}

export interface ReplLinks {
  rollup: ReplLink | OmittedReplLink;
  rolldown: ReplLink | OmittedReplLink;
}

export interface ReplLinkOptions {
  rollupVersion?: string;
  rolldownVersion?: string;
  maxUrlLength?: number;
}

export interface ReplContractSource {
  name: string;
  url: string;
  sha256: string;
  purpose: string;
}

export const defaultMaxReplUrlLength = 7_000;

export const replContractSources: ReplContractSource[] = [
  {
    name: "rollup-query-state",
    url: "https://raw.githubusercontent.com/rollup/rollup/master/docs/repl/helpers/query.ts",
    sha256: "2ab390f525c06f2e98fe09ef4764eef7fb126584947f4dd95f07ebaa4ee51956",
    purpose: "Rollup REPL shareable query parameter parser and serializer",
  },
  {
    name: "rolldown-url-state",
    url: "https://raw.githubusercontent.com/rolldown/repl/main/app/state/url.ts",
    sha256: "4b3dd010ee11231c6188e34f1910699ed76d95c2993448d7c58cfd0af4aafe8b",
    purpose: "Rolldown REPL hash-state loader and serializer",
  },
  {
    name: "rolldown-url-codec",
    url: "https://raw.githubusercontent.com/rolldown/repl/main/app/utils/url.ts",
    sha256: "afb9ab84a4a1b2ebf81ba6be3a7045fe81f998e9bbe57f9594607c0a5f333d4b",
    purpose: "Rolldown REPL zlib/base64 URL codec",
  },
  {
    name: "rolldown-source-file-json",
    url: "https://raw.githubusercontent.com/rolldown/repl/main/app/composables/source-file.ts",
    sha256: "6549bbe38d4cc4fca074a9d3f9b71069e050d0aad071d29fd4785ee2b4148e4b",
    purpose: "Rolldown REPL source-file JSON schema",
  },
];

interface RollupReplState {
  example: null;
  modules: {
    name: string;
    code: string;
    isEntry: boolean;
  }[];
  options: {
    treeshake: true;
    output: {
      format: "esm";
    };
  };
}

interface RolldownReplState {
  v: string;
  f: Record<
    string,
    {
      n: string;
      c: string;
      e: boolean;
    }
  >;
}

export function createReplLinks(fixture: ModuleFixture, options: ReplLinkOptions = {}): ReplLinks {
  return {
    rollup: limitUrl(createRollupReplUrl(fixture, options), options.maxUrlLength),
    rolldown: limitUrl(createRolldownReplUrl(fixture, options), options.maxUrlLength),
  };
}

export function createRollupReplUrl(fixture: ModuleFixture, options: ReplLinkOptions = {}) {
  const state: RollupReplState = {
    example: null,
    modules: fixture.files.map((file) => ({
      name: file.path,
      code: file.source,
      isEntry: file.path === fixture.entry,
    })),
    options: {
      treeshake: true,
      output: {
        format: "esm",
      },
    },
  };
  const parameters = new URLSearchParams({
    shareable: encodeRollupShareable(state),
  });

  if (options.rollupVersion) parameters.set("version", options.rollupVersion);

  return `https://rollupjs.org/repl/?${parameters.toString()}`;
}

export function createRolldownReplUrl(fixture: ModuleFixture, options: ReplLinkOptions = {}) {
  const state: RolldownReplState = {
    v: options.rolldownVersion ?? "latest",
    f: Object.fromEntries(
      fixture.files.map((file) => [
        file.path,
        {
          n: file.path,
          c: file.source,
          e: file.path === fixture.entry,
        },
      ]),
    ),
  };

  return `https://repl.rolldown.rs/#${encodeRolldownHashState(state)}`;
}

export function decodeRollupShareableState(shareable: string): RollupReplState {
  const rawJson = Buffer.from(
    shareable.replaceAll("_", "/").replaceAll("-", "+"),
    "base64",
  ).toString("latin1");
  const json = rawJson[0] === "%" ? decodeURIComponent(rawJson) : rawJson;

  return JSON.parse(json) as RollupReplState;
}

export function decodeRolldownHashState(hash: string): RolldownReplState {
  const state = hash.startsWith("#") ? hash.slice(1) : hash;
  const buffer = Buffer.from(state, "base64");
  const json = inflateSync(buffer).toString("utf8");

  return JSON.parse(json) as RolldownReplState;
}

function encodeRollupShareable(state: RollupReplState) {
  const json = JSON.stringify(state);
  const encoded = isLatin1(json) ? json : encodeURIComponent(json);

  return Buffer.from(encoded, "latin1")
    .toString("base64")
    .replaceAll("/", "_")
    .replaceAll("+", "-");
}

function encodeRolldownHashState(state: RolldownReplState) {
  return deflateSync(JSON.stringify(state), { level: 9 }).toString("base64");
}

function limitUrl(url: string, maxUrlLength = defaultMaxReplUrlLength): ReplLink | OmittedReplLink {
  if (url.length <= maxUrlLength) {
    return {
      status: "ok",
      url,
      length: url.length,
    };
  }

  return {
    status: "omitted",
    reason: `URL length ${url.length} exceeds max ${maxUrlLength}`,
    length: url.length,
  };
}

function isLatin1(value: string) {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 0xff) return false;
  }

  return true;
}
