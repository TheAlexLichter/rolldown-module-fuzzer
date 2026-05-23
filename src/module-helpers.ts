export type ModulePathKind =
  | "default"
  | "dynamic"
  | "named-reexport"
  | "namespace"
  | "side-effect"
  | "star-reexport"
  | "static";

export type ModuleFormat = "cjs" | "esm";

export const allModuleFormats: ModuleFormat[] = ["esm", "cjs"];

export const allModulePathKinds: ModulePathKind[] = [
  "static",
  "namespace",
  "dynamic",
  "default",
  "named-reexport",
  "star-reexport",
  "side-effect",
];

export interface ModuleBuilderOptions {
  id: number;
  path: string;
  seed: number;
  includeSideEffect?: boolean;
}

export interface BuiltModule {
  path: string;
  source: string;
  valueExport: string;
  defaultExport: string;
}

export class ModuleBuilder {
  readonly #id: number;
  readonly #path: string;
  readonly #seed: number;
  readonly #lines: string[] = [];
  readonly #terms: string[] = [];
  #temporaryIndex = 0;

  constructor({ id, path, seed, includeSideEffect = false }: ModuleBuilderOptions) {
    this.#id = id;
    this.#path = path;
    this.#seed = seed;

    if (includeSideEffect)
      this.#lines.push("globalThis.__compatLog ??= [];", `globalThis.__compatLog.push('m${id}');`);
  }

  addDefaultImport(specifier: string, exportName: string, member?: string) {
    const local = this.#temporary("defaultValue");
    const expression = member ? `${local}.${member}` : local;
    this.#lines.push(`import ${local} from '${specifier}';`);
    this.#terms.push(expression);
    this.#lines.push(`export const ${exportName} = ${expression};`);
  }

  addDynamicImport(specifier: string, importedName: string, exportName: string) {
    const local = this.#temporary("dynamicNs");
    this.#lines.push(`const ${local} = await import('${specifier}');`);
    this.#terms.push(`${local}.${importedName}`);
    this.#lines.push(`export const ${exportName} = ${local}.${importedName};`);
  }

  addNamedReexport(specifier: string, importedName: string, exportName: string) {
    this.#lines.push(`export { ${importedName} as ${exportName} } from '${specifier}';`);
  }

  addNamespaceImport(specifier: string, importedName: string, exportName: string) {
    const local = this.#temporary("ns");
    this.#lines.push(`import * as ${local} from '${specifier}';`);
    this.#terms.push(`${local}.${importedName}`);
    this.#lines.push(`export const ${exportName} = ${local}.${importedName};`);
  }

  addSideEffectImport(specifier: string) {
    this.#lines.push(`import '${specifier}';`);
  }

  addStarReexport(specifier: string) {
    this.#lines.push(`export * from '${specifier}';`);
  }

  addStaticImport(specifier: string, importedName: string, exportName: string) {
    const local = this.#temporary("staticValue");
    this.#lines.push(`import { ${importedName} as ${local} } from '${specifier}';`);
    this.#terms.push(local);
    this.#lines.push(`export const ${exportName} = ${local};`);
  }

  build(): BuiltModule {
    const valueExport = valueExportName(this.#id);
    const defaultExport = defaultExportName(this.#id);
    const base = this.#seed + this.#id + 1;
    const expression =
      this.#terms.length === 0 ? `${base}` : `${base} + ${this.#terms.join(" + ")}`;

    return {
      path: this.#path,
      source: [
        ...this.#lines,
        `export const ${valueExport} = ${expression};`,
        `export default ${valueExport};`,
        "",
      ].join("\n"),
      valueExport,
      defaultExport,
    };
  }

  #temporary(prefix: string) {
    return `${prefix}${this.#id}_${this.#temporaryIndex++}`;
  }
}

export function defaultExportName(id: number) {
  return `default${id}`;
}

export function relativeSpecifier(fromPath: string, toPath: string) {
  const fromSegments = fromPath.split("/");
  const toSegments = toPath.split("/");
  fromSegments.pop();

  while (fromSegments[0] === toSegments[0]) {
    fromSegments.shift();
    toSegments.shift();
  }

  const prefix = fromSegments.map(() => "..");
  const segments = [...prefix, ...toSegments];
  const specifier = segments.length === 1 ? `./${segments[0]}` : segments.join("/");

  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

export function valueExportName(id: number) {
  return `v${id}`;
}
