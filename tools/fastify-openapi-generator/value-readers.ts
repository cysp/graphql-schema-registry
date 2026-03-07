import { GeneratorError } from "./errors.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GeneratorError(`${context} must be an object.`);
  }

  return value;
}

export function readOptionalRecord(
  value: unknown,
  context: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readRecord(value, context);
}

export function readArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new GeneratorError(`${context} must be an array.`);
  }

  return value;
}

export function readOptionalArray(value: unknown, context: string): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readArray(value, context);
}

export function readString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new GeneratorError(`${context} must be a string.`);
  }

  return value;
}

export function readOptionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, context);
}

export function readNonEmptyString(value: unknown, context: string): string {
  const stringValue = readString(value, context);
  if (stringValue.trim() === "") {
    throw new GeneratorError(`${context} must be a non-empty string.`);
  }

  return stringValue;
}

export function readOptionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new GeneratorError(`${context} must be a boolean.`);
  }

  return value;
}

export function readStringArray(value: unknown, context: string): string[] {
  const values = readArray(value, context);

  return values.map((entry, index) => readNonEmptyString(entry, `${context}[${index}]`));
}
