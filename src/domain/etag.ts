export type EntityTagCondition =
  | {
      kind: "wildcard";
    }
  | {
      kind: "entity-tag-list";
      entityTags: string[];
    };

function isOptionalWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function skipOptionalWhitespace(value: string, index: number): number {
  let nextIndex = index;

  while (isOptionalWhitespace(value[nextIndex])) {
    nextIndex += 1;
  }

  return nextIndex;
}

function isEntityTagCharacter(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }

  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  // RFC 9110 Section 8.8.3 defines `etagc` as %x21 / %x23-7E / obs-text.
  // RFC 9110 Section 5.5 defines `obs-text` as %x80-FF.
  return (
    codePoint === 0x21 ||
    (codePoint >= 0x23 && codePoint <= 0x7e) ||
    (codePoint >= 0x80 && codePoint <= 0xff)
  );
}

function parseEntityTag(
  value: string,
  index: number,
): { entityTag: string; nextIndex: number } | undefined {
  let nextIndex = index;

  if (value.startsWith("W/", nextIndex)) {
    nextIndex += 2;
  }

  // RFC 9110 Section 8.8.3: entity-tag = [ weak ] opaque-tag.
  if (value[nextIndex] !== '"') {
    return undefined;
  }

  nextIndex += 1;

  while (nextIndex < value.length && value[nextIndex] !== '"') {
    if (!isEntityTagCharacter(value[nextIndex])) {
      return undefined;
    }

    nextIndex += 1;
  }

  if (value[nextIndex] !== '"') {
    return undefined;
  }

  nextIndex += 1;

  return {
    entityTag: value.slice(index, nextIndex),
    nextIndex,
  };
}

function parseEntityTagList(headerValue: string): string[] {
  const entityTags: string[] = [];
  let nextIndex = 0;

  while (nextIndex < headerValue.length) {
    nextIndex = skipOptionalWhitespace(headerValue, nextIndex);

    if (headerValue[nextIndex] === ",") {
      nextIndex += 1;
      continue;
    }

    const parsedEntityTag = parseEntityTag(headerValue, nextIndex);
    if (parsedEntityTag === undefined) {
      break;
    }

    entityTags.push(parsedEntityTag.entityTag);
    nextIndex = skipOptionalWhitespace(headerValue, parsedEntityTag.nextIndex);

    if (headerValue[nextIndex] === ",") {
      nextIndex += 1;
      continue;
    }

    break;
  }

  nextIndex = skipOptionalWhitespace(headerValue, nextIndex);

  if (nextIndex !== headerValue.length) {
    throw new Error("Invalid entity-tag list.");
  }

  return entityTags;
}

function encodeEntityTagComponent(value: string): string {
  // RFC 9110 Section 8.8.3 makes entity-tags opaque and constrains the quoted
  // content to `etagc`, so resource IDs are percent-encoded before embedding.
  // RFC 9110 Section 8.8.3 also notes that backslash is allowed by the grammar
  // but servers ought to avoid it because some recipients still unescape it.
  return encodeURIComponent(value);
}

export function formatStrongETag(resourceId: string, revision: number): string {
  return `"${encodeEntityTagComponent(resourceId)}:${String(revision)}"`;
}

function parseEntityTagHeader(
  headerValue: string | string[] | undefined,
): EntityTagCondition | undefined {
  if (headerValue === undefined) {
    return undefined;
  }

  const values = typeof headerValue === "string" ? [headerValue] : headerValue;
  const entityTags: string[] = [];
  let wildcardCount = 0;

  for (const value of values) {
    const normalizedValue = value.trim();

    if (normalizedValue === "") {
      continue;
    }

    if (normalizedValue === "*") {
      wildcardCount += 1;
      continue;
    }

    entityTags.push(...parseEntityTagList(normalizedValue));
  }

  if (wildcardCount > 0) {
    // RFC 9110 Sections 13.1.1 and 13.1.2 define these fields as `* / #entity-tag`,
    // so `*` is only valid as the sole member of the combined field value.
    if (wildcardCount > 1 || entityTags.length > 0) {
      throw new Error("Invalid entity-tag condition.");
    }

    return {
      kind: "wildcard",
    };
  }

  return {
    kind: "entity-tag-list",
    entityTags,
  };
}

function wrapEntityTagHeaderError(headerName: string, error: unknown): Error {
  const reason = error instanceof Error ? ` ${error.message}` : "";
  return new Error(`Invalid ${headerName} header.${reason}`, {
    cause: error,
  });
}

export function parseIfMatchHeader(
  headerValue: string | string[] | undefined,
): EntityTagCondition | undefined {
  try {
    return parseEntityTagHeader(headerValue);
  } catch (error) {
    throw wrapEntityTagHeaderError("If-Match", error);
  }
}

export function parseIfNoneMatchHeader(
  headerValue: string | string[] | undefined,
): EntityTagCondition | undefined {
  try {
    return parseEntityTagHeader(headerValue);
  } catch (error) {
    throw wrapEntityTagHeaderError("If-None-Match", error);
  }
}

export function etagSatisfiesIfMatch(
  precondition: EntityTagCondition | undefined,
  currentEntityTag: string | undefined,
): boolean {
  if (precondition === undefined) {
    return true;
  }

  if (currentEntityTag === undefined) {
    return false;
  }

  if (precondition.kind === "wildcard") {
    // RFC 9110 Section 13.1.1: `If-Match: *` succeeds only if a current
    // representation exists, which is equivalent to having a current entity-tag.
    return true;
  }

  // RFC 9110 Section 13.1.1 requires strong comparison for `If-Match`.
  return precondition.entityTags.some(
    (candidateEntityTag) =>
      !candidateEntityTag.startsWith("W/") && candidateEntityTag === currentEntityTag,
  );
}

function normalizeEntityTag(entityTag: string): string {
  return entityTag.startsWith("W/") ? entityTag.slice(2) : entityTag;
}

export function etagSatisfiesIfNoneMatch(
  precondition: EntityTagCondition | undefined,
  currentEntityTag: string | undefined,
): boolean {
  if (precondition === undefined) {
    return true;
  }

  if (precondition.kind === "wildcard") {
    // RFC 9110 Section 13.1.2: `If-None-Match: *` fails only when a current
    // representation exists, so the precondition passes iff the resource is absent.
    return currentEntityTag === undefined;
  }

  if (currentEntityTag === undefined) {
    return true;
  }

  const normalizedCurrentEntityTag = normalizeEntityTag(currentEntityTag);

  // RFC 9110 Section 13.1.2 requires weak comparison for `If-None-Match`.
  for (const candidateEntityTag of precondition.entityTags) {
    if (normalizeEntityTag(candidateEntityTag) === normalizedCurrentEntityTag) {
      return false;
    }
  }

  return true;
}
