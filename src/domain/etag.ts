export type IfMatchCondition =
  | {
      kind: "any";
    }
  | {
      kind: "tags";
      tags: string[];
    };

const entityTagPatternSource = String.raw`(?:W/)?"[\u0021\u0023-\u007E\u0080-\u00FF]*"`;
const optionalWhitespacePatternSource = String.raw`[ \t]*`;
const ifMatchPattern = new RegExp(
  String.raw`^(?:\*|${entityTagPatternSource}(?:${optionalWhitespacePatternSource},${optionalWhitespacePatternSource}${entityTagPatternSource})*)$`,
);

function parseEntityTags(headerValue: string): string[] {
  if (!ifMatchPattern.test(headerValue)) {
    throw new Error("Invalid If-Match header.");
  }

  return Array.from(
    headerValue.matchAll(new RegExp(entityTagPatternSource, "g")),
    ([entityTag]) => entityTag,
  );
}

export function formatStrongETag(resourceId: string, revisionId: number): string {
  return `"${resourceId}:${String(revisionId)}"`;
}

export function parseIfMatchHeader(
  headerValue: string | string[] | undefined,
): IfMatchCondition | undefined {
  if (headerValue === undefined) {
    return undefined;
  }

  const normalizedHeaderValue =
    typeof headerValue === "string" ? headerValue.trim() : headerValue.join(",").trim();

  if (normalizedHeaderValue === "") {
    return undefined;
  }

  if (normalizedHeaderValue === "*") {
    return {
      kind: "any",
    };
  }

  return {
    kind: "tags",
    tags: parseEntityTags(normalizedHeaderValue),
  };
}

export function etagSatisfiesIfMatch(
  condition: IfMatchCondition | undefined,
  currentEtag: string | undefined,
): boolean {
  if (condition === undefined) {
    return true;
  }

  if (currentEtag === undefined) {
    return false;
  }

  if (condition.kind === "any") {
    return true;
  }

  return condition.tags.some(
    (candidate) => !candidate.startsWith("W/") && candidate === currentEtag,
  );
}
