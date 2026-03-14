const identifierStartPattern = /^[A-Za-z_]/;
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function splitWords(value: string): string[] {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function prefixGeneratedIdentifier(value: string): string {
  if (value === "") {
    return "generated";
  }

  if (identifierStartPattern.test(value)) {
    return value;
  }

  return `generated${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function toCamelCaseIdentifier(value: string): string {
  const words = splitWords(value);
  const firstWord = words[0];
  if (!firstWord) {
    return "generated";
  }

  const remainingWords = words.slice(1);
  return prefixGeneratedIdentifier(
    `${firstWord.toLowerCase()}${remainingWords
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join("")}`,
  );
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

export function toComponentSchemaVariableName(componentName: string): string {
  return `${toCamelCaseIdentifier(componentName)}Schema`;
}

export function toComponentJsonSchemaVariableName(componentName: string): string {
  return `${toCamelCaseIdentifier(componentName)}JsonSchema`;
}

export function toKebabCaseFileStem(value: string): string {
  return toKebabCaseSegment(value);
}
