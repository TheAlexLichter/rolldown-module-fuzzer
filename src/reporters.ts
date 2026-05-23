import type { CompatResult } from "./diff.ts";
import type { ReplLinks } from "./repl.ts";

export const reporterFormats = ["text", "github"] as const;

export type ReporterFormat = (typeof reporterFormats)[number];

export interface ReporterMetadata {
  command: string;
}

export interface GithubReporterOptions {
  repl?: ReplLinks;
  reproPath?: string;
}

type GithubAnnotationLevel = "error" | "warning";

interface GithubAnnotation {
  level: GithubAnnotationLevel;
  message: string;
  title: string;
  file?: string;
}

export function isReporterFormat(value: string | undefined): value is ReporterFormat {
  return reporterFormats.includes(value as ReporterFormat);
}

export function detectDefaultReporterFormat(env: Record<string, string | undefined>) {
  return env.GITHUB_ACTIONS === "true" ? "github" : "text";
}

export function createGithubAnnotations(
  result: CompatResult,
  metadata: ReporterMetadata,
  options: GithubReporterOptions = {},
) {
  const annotations: GithubAnnotation[] = [];

  for (const warning of result.warnings) {
    annotations.push({
      level: "warning",
      title: `Compat warning: ${result.fixture}`,
      message: createFailureMessage(result.fixture, warning, metadata, options.repl),
    });
  }

  for (const bundler of ["rollup", "rolldown"] as const) {
    const outcome = result[bundler];

    for (const warning of outcome.warnings) {
      annotations.push({
        level: "warning",
        title: `${formatBundlerName(bundler)} warning: ${result.fixture}`,
        message: warning,
      });
    }
  }

  if (!result.matches) {
    for (const difference of result.differences) {
      annotations.push({
        level: "error",
        title: `Compat mismatch: ${result.fixture}`,
        file: options.reproPath,
        message: createFailureMessage(result.fixture, difference, metadata, options.repl),
      });
    }

    for (const bundler of ["rollup", "rolldown"] as const) {
      const outcome = result[bundler];
      if (outcome.status !== "error") continue;

      annotations.push({
        level: "error",
        title: `${formatBundlerName(bundler)} build error: ${result.fixture}`,
        file: options.reproPath,
        message: createFailureMessage(result.fixture, outcome.error, metadata, options.repl),
      });
    }
  }

  return annotations.map(formatGithubAnnotation);
}

function createFailureMessage(
  fixture: string,
  detail: string,
  metadata: ReporterMetadata,
  replLinks: ReplLinks | undefined,
) {
  const lines = [`fixture: ${fixture}`, detail, `command: ${metadata.command}`];

  if (replLinks) {
    lines.push(formatReplLine("rollup", replLinks.rollup));
    lines.push(formatReplLine("rolldown", replLinks.rolldown));
  }

  return lines.join("\n");
}

function formatReplLine(label: string, link: ReplLinks["rollup"]) {
  if (link.status === "ok") return `${label} repl: ${link.url}`;

  return `${label} repl: omitted (${link.reason})`;
}

function formatBundlerName(name: "rollup" | "rolldown") {
  return name === "rollup" ? "Rollup" : "Rolldown";
}

function formatGithubAnnotation(annotation: GithubAnnotation) {
  const properties = [
    annotation.file ? `file=${escapeGithubAnnotationProperty(annotation.file)}` : undefined,
    `title=${escapeGithubAnnotationProperty(annotation.title)}`,
  ].filter((property): property is string => Boolean(property));

  return `::${annotation.level} ${properties.join(",")}::${escapeGithubAnnotationData(
    annotation.message,
  )}`;
}

function escapeGithubAnnotationProperty(value: string) {
  return escapeGithubAnnotationData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function escapeGithubAnnotationData(value: string) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
