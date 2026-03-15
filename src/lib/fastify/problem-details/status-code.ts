type EnumerateNumbers<
  Maximum extends number,
  Accumulator extends number[] = [],
> = Accumulator["length"] extends Maximum
  ? Accumulator[number]
  : EnumerateNumbers<Maximum, [...Accumulator, Accumulator["length"]]>;

export type ProblemDetailsStatusCode = Exclude<EnumerateNumbers<600>, EnumerateNumbers<400>>;

const minProblemDetailsStatusCode = 400;
const maxProblemDetailsStatusCode = 599;

export function isProblemDetailsStatusCode(status: number): status is ProblemDetailsStatusCode {
  return (
    Number.isInteger(status) &&
    status >= minProblemDetailsStatusCode &&
    status <= maxProblemDetailsStatusCode
  );
}

export function coerceProblemDetailsStatusCode(
  status: number,
): ProblemDetailsStatusCode | undefined {
  return isProblemDetailsStatusCode(status) ? status : undefined;
}

export function requireProblemDetailsStatusCode(status: number): ProblemDetailsStatusCode {
  const statusCode = coerceProblemDetailsStatusCode(status);
  if (statusCode !== undefined) {
    return statusCode;
  }

  throw new TypeError(
    `problemDetails status must be an integer HTTP error status code between ${minProblemDetailsStatusCode} and ${maxProblemDetailsStatusCode}; received ${String(status)}.`,
  );
}
