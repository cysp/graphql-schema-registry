export function parseAuthorizationToken(
  headerValue: string | string[] | undefined,
): string | undefined {
  if (typeof headerValue !== "string") {
    return undefined;
  }

  return headerValue;
}
