// Docs links (SHARED-SPEC §12.3).
const DEFAULT_DOCS_URL = "https://docs.openapphub.org";

export function docsUrl(path = ""): string {
  const base = (import.meta.env.VITE_DOCS_URL || DEFAULT_DOCS_URL).replace(/\/+$/, "");
  const clean = path.replace(/^\/+/, "");
  return clean ? `${base}/${clean}` : `${base}/`;
}

export type HelpMap = Record<string, string>;

export function helpUrl<T extends HelpMap>(map: T, key: keyof T): string {
  return docsUrl(map[key]);
}
