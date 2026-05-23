import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { replContractSources, type ReplContractSource } from "./repl.ts";

export interface ReplContractCheckOk {
  source: ReplContractSource;
  status: "ok";
  actualSha256: string;
}

export interface ReplContractCheckMismatch {
  source: ReplContractSource;
  status: "mismatch";
  actualSha256: string;
  expectedSha256: string;
}

export type ReplContractCheckResult = ReplContractCheckOk | ReplContractCheckMismatch;

export async function checkReplContracts(
  sources: readonly ReplContractSource[] = replContractSources,
): Promise<ReplContractCheckResult[]> {
  const results: ReplContractCheckResult[] = [];

  for (const source of sources) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Failed to fetch ${source.url}: ${response.status}`);

    const actualSha256 = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");

    if (actualSha256 === source.sha256) {
      results.push({ source, status: "ok", actualSha256 });
      continue;
    }

    results.push({
      source,
      status: "mismatch",
      actualSha256,
      expectedSha256: source.sha256,
    });
  }

  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await checkReplContracts();
  let failed = false;

  for (const result of results) {
    if (result.status === "ok") {
      console.log(`ok ${result.source.name} ${result.actualSha256}`);
      continue;
    }

    failed = true;
    console.log(`mismatch ${result.source.name}`);
    console.log(`  purpose: ${result.source.purpose}`);
    console.log(`  url: ${result.source.url}`);
    console.log(`  expected: ${result.expectedSha256}`);
    console.log(`  actual:   ${result.actualSha256}`);
  }

  if (failed) process.exitCode = 1;
}
