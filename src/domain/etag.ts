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

  return codePoint === 0x21 || (codePoint >= 0x23 && codePoint <= 0x7e) || codePoint >= 0x80;
}

function parseEntityTag(
  value: string,
  index: number,
): { entityTag: string; nextIndex: number } | undefined {
  let nextIndex = index;

  if (value.startsWith("W/", nextIndex)) {
    nextIndex += 2;
  }

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

  if (entityTags.length === 0 || nextIndex !== headerValue.length) {
    throw new Error("Invalid entity-tag list.");
  }

  return entityTags;
}

function encodeEntityTagComponent(value: string): string {
  // RFC 9110 entity-tags are opaque quoted strings, not quoted-string values.
  // Percent-encoding keeps arbitrary IDs within the allowed character set and
  // avoids raw backslashes, which the RFC recommends servers avoid emitting.
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
  let hasWildcard = false;

  for (const value of values) {
    const normalizedValue = value.trim();

    if (normalizedValue === "") {
      continue;
    }

    if (normalizedValue === "*") {
      hasWildcard = true;
      continue;
    }

    entityTags.push(...parseEntityTagList(normalizedValue));
  }

  if (hasWildcard) {
    if (entityTags.length > 0) {
      throw new Error("Invalid entity-tag condition.");
    }

    return {
      kind: "wildcard",
    };
  }

  if (entityTags.length === 0) {
    return undefined;
  }

  return {
    kind: "entity-tag-list",
    entityTags,
  };
}

export function parseIfMatchHeader(
  headerValue: string | string[] | undefined,
): EntityTagCondition | undefined {
  return parseEntityTagHeader(headerValue);
}

export function parseIfNoneMatchHeader(
  headerValue: string | string[] | undefined,
): EntityTagCondition | undefined {
  return parseEntityTagHeader(headerValue);
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
    return true;
  }

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
    return currentEntityTag === undefined;
  }

  if (currentEntityTag === undefined) {
    return true;
  }

  const normalizedCurrentEntityTag = normalizeEntityTag(currentEntityTag);

  for (const candidateEntityTag of precondition.entityTags) {
    if (normalizeEntityTag(candidateEntityTag) === normalizedCurrentEntityTag) {
      return false;
    }
  }

  return true;
}
