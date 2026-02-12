export interface ParsedPackageName {
  scope: string;
  name: string;
  fullName: string;
}

export function parseScopedPackageName(value: string): ParsedPackageName | null {
  if (!value.startsWith("@")) {
    return null;
  }

  const parts = value.split("/");
  if (parts.length !== 2) {
    return null;
  }

  const scope = parts[0];
  const name = parts[1];

  if (scope === undefined || name === undefined) {
    return null;
  }

  if (scope.length <= 1 || name.length === 0) {
    return null;
  }

  return {
    scope,
    name,
    fullName: `${scope}/${name}`,
  };
}

export function buildScopedPackagePath(scope: string, name: string): string {
  return `/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`;
}
