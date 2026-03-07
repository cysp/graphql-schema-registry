const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function splitWords(value: string): string[] {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
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
  return openApiPath.replaceAll(/\{([^}]+)\}/g, ":$1");
}

export function toKebabCaseFileStem(value: string): string {
  return toKebabCaseSegment(value);
}
