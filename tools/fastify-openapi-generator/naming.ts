const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function splitWords(value: string): string[] {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[^A-Za-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function toKebabCaseSegment(value: string): string {
  const words = splitWords(value);
  if (words.length === 0) {
    return "generated";
  }

  return words.map((word) => word.toLowerCase()).join("-");
}

export function isValidIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

export function toFastifyPath(openApiPath: string): string {
  return openApiPath.replaceAll(/\{([^}]+)\}/gu, ":$1");
}

export function toKebabCaseFileStem(value: string): string {
  return toKebabCaseSegment(value);
}
