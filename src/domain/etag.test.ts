import assert from "node:assert/strict";
import test from "node:test";

import {
  type EntityTagCondition,
  etagSatisfiesIfMatch,
  etagSatisfiesIfNoneMatch,
  formatStrongETag,
  parseIfMatchHeader,
  parseIfNoneMatchHeader,
  parseResourceRevisionEntityTag,
} from "./etag.ts";

type ParseHeader = (headerValue: string | string[] | undefined) => EntityTagCondition | undefined;

const invalidHeaderErrorMessages = {
  "parseIfMatchHeader()": {
    condition: "Invalid If-Match header. Invalid entity-tag condition.",
    list: "Invalid If-Match header. Invalid entity-tag list.",
  },
  "parseIfNoneMatchHeader()": {
    condition: "Invalid If-None-Match header. Invalid entity-tag condition.",
    list: "Invalid If-None-Match header. Invalid entity-tag list.",
  },
} as const;

type ParserName = keyof typeof invalidHeaderErrorMessages;
type InvalidHeaderErrorKind = keyof (typeof invalidHeaderErrorMessages)[ParserName];

const parserCases = [
  {
    name: "returns undefined when the header is missing",
    input: undefined,
    expected: undefined,
  },
  {
    name: "parses an empty string as an empty entity-tag list",
    input: "",
    expected: {
      kind: "entity-tag-list",
      entityTags: [],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses blank repeated values as an empty entity-tag list",
    input: ["", "  "],
    expected: {
      kind: "entity-tag-list",
      entityTags: [],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses empty list elements as an empty entity-tag list",
    input: " , \t, ",
    expected: {
      kind: "entity-tag-list",
      entityTags: [],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses wildcard with surrounding whitespace",
    input: " \t*\t ",
    expected: { kind: "wildcard" } satisfies EntityTagCondition,
  },
  {
    name: "parses a single header value with multiple tags and optional whitespace",
    input: ' "graph-1:1"\t,\tW/"graph-1:2" ',
    expected: {
      kind: "entity-tag-list",
      entityTags: ['"graph-1:1"', 'W/"graph-1:2"'],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses repeated header values and ignores blank entries",
    input: ['W/"graph-1:1"', "", "  ", '"graph-1:3"'],
    expected: {
      kind: "entity-tag-list",
      entityTags: ['W/"graph-1:1"', '"graph-1:3"'],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses a tag with a comma inside the quoted value",
    input: '"graph,1:2"',
    expected: {
      kind: "entity-tag-list",
      entityTags: ['"graph,1:2"'],
    } satisfies EntityTagCondition,
  },
  {
    name: "parses empty opaque tags",
    input: 'W/""',
    expected: {
      kind: "entity-tag-list",
      entityTags: ['W/""'],
    } satisfies EntityTagCondition,
  },
  {
    name: "ignores empty list elements in a combined field value",
    input: ' , "graph-1:1", , W/"graph-1:2", ',
    expected: {
      kind: "entity-tag-list",
      entityTags: ['"graph-1:1"', 'W/"graph-1:2"'],
    } satisfies EntityTagCondition,
  },
];

const invalidParserInputs = [
  {
    name: "rejects wildcard mixed with tags across repeated values",
    input: ["*", '"graph-1:3"'],
    expectedErrorKind: "condition",
  },
  {
    name: "rejects repeated wildcard values across repeated headers",
    input: ["*", "*"],
    expectedErrorKind: "condition",
  },
  {
    name: "rejects wildcard mixed with tags in one header value",
    input: '*, "graph-1:3"',
    expectedErrorKind: "list",
  },
  {
    name: "rejects unquoted values",
    input: "graph-1:3",
    expectedErrorKind: "list",
  },
  {
    name: "rejects lowercase weak prefixes",
    input: 'w/"graph-1:3"',
    expectedErrorKind: "list",
  },
  {
    name: "rejects characters outside the RFC 9110 obs-text range",
    input: '"graph-\u{1F680}:3"',
    expectedErrorKind: "list",
  },
] satisfies ReadonlyArray<{
  expectedErrorKind: InvalidHeaderErrorKind;
  input: string | string[];
  name: string;
}>;

async function runParserContractTests(parserName: ParserName, parser: ParseHeader): Promise<void> {
  return test(parserName, async (t) => {
    for (const testCase of parserCases) {
      await t.test(testCase.name, () => {
        assert.deepEqual(parser(testCase.input), testCase.expected);
      });
    }

    await t.test("reports invalid entity-tag list syntax", () => {
      assert.throws(
        () => parser("invalid-etag"),
        new Error(invalidHeaderErrorMessages[parserName].list),
      );
    });

    for (const testCase of invalidParserInputs) {
      await t.test(testCase.name, () => {
        assert.throws(
          () => parser(testCase.input),
          new Error(invalidHeaderErrorMessages[parserName][testCase.expectedErrorKind]),
        );
      });
    }
  });
}

await test("formatStrongETag()", async (t) => {
  const cases = [
    {
      name: "formats an unchanged ASCII identifier",
      resourceId: "graph-1",
      revision: 2,
      expected: '"graph-1:2"',
    },
    {
      name: "percent-encodes quotes and backslashes",
      resourceId: 'graph\\"1',
      revision: 2,
      expected: '"graph%5C%221:2"',
    },
    {
      name: "percent-encodes non-ASCII characters",
      resourceId: "g\u00E4\uD83D\uDE80",
      revision: 7,
      expected: '"g%C3%A4%F0%9F%9A%80:7"',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      assert.equal(formatStrongETag(testCase.resourceId, testCase.revision), testCase.expected);
    });
  }

  await t.test("produces tags that round-trip through If-Match parsing", () => {
    const etag = formatStrongETag('graph\\"1', 3);

    assert.deepEqual(parseIfMatchHeader(etag), {
      kind: "entity-tag-list",
      entityTags: [etag],
    });
    assert.equal(etagSatisfiesIfMatch(parseIfMatchHeader(etag), etag), true);
  });
});

await test("parseResourceRevisionEntityTag()", async (t) => {
  await t.test("parses a strong tag into resource id and revision", () => {
    assert.deepEqual(parseResourceRevisionEntityTag('"graph-1:2"'), {
      resourceId: "graph-1",
      revision: 2n,
      weak: false,
    });
  });

  await t.test("parses a weak tag into resource id and revision", () => {
    assert.deepEqual(parseResourceRevisionEntityTag('W/"graph-1:2"'), {
      resourceId: "graph-1",
      revision: 2n,
      weak: true,
    });
  });

  await t.test("decodes percent-encoded resource ids", () => {
    assert.deepEqual(parseResourceRevisionEntityTag('"graph%2Fwith%20space:7"'), {
      resourceId: "graph/with space",
      revision: 7n,
      weak: false,
    });
  });

  await t.test("returns undefined for malformed structured tags", () => {
    for (const value of ['"graph-1"', '"graph-1:not-a-number"', '"%E0%A4%A:3"', "graph-1:3"]) {
      assert.equal(parseResourceRevisionEntityTag(value), undefined);
    }
  });
});

await runParserContractTests("parseIfMatchHeader()", parseIfMatchHeader);

await runParserContractTests("parseIfNoneMatchHeader()", parseIfNoneMatchHeader);

await test("etagSatisfiesIfMatch()", async (t) => {
  const cases = [
    {
      name: "passes when the precondition is missing",
      precondition: undefined,
      currentEntityTag: undefined,
      expected: true,
    },
    {
      name: "fails when the header is present but the entity-tag list is empty",
      precondition: {
        kind: "entity-tag-list",
        entityTags: [],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "fails when wildcard is present but the resource is missing",
      precondition: { kind: "wildcard" } satisfies EntityTagCondition,
      currentEntityTag: undefined,
      expected: false,
    },
    {
      name: "fails when specific tags are present but the resource is missing",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: undefined,
      expected: false,
    },
    {
      name: "passes wildcard when the resource exists",
      precondition: { kind: "wildcard" } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
    {
      name: "passes for a matching strong tag",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
    {
      name: "fails for a weak candidate against a strong current tag",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['W/"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "passes when any strong candidate matches in a multi-tag list",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:1"', 'W/"graph-1:2"', '"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
    {
      name: "fails when only weak matches are present in a multi-tag list",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:1"', 'W/"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "fails when the current tag itself is weak",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: 'W/"graph-1:2"',
      expected: false,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      assert.equal(
        etagSatisfiesIfMatch(testCase.precondition, testCase.currentEntityTag),
        testCase.expected,
      );
    });
  }
});

await test("etagSatisfiesIfNoneMatch()", async (t) => {
  const cases = [
    {
      name: "passes when the precondition is missing",
      precondition: undefined,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
    {
      name: "passes when the header is present but the entity-tag list is empty",
      precondition: {
        kind: "entity-tag-list",
        entityTags: [],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
    {
      name: "wildcard passes only when the resource is missing",
      precondition: { kind: "wildcard" } satisfies EntityTagCondition,
      currentEntityTag: undefined,
      expected: true,
    },
    {
      name: "wildcard fails when a strong current tag exists",
      precondition: { kind: "wildcard" } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "wildcard fails when a weak current tag exists",
      precondition: { kind: "wildcard" } satisfies EntityTagCondition,
      currentEntityTag: 'W/"graph-1:2"',
      expected: false,
    },
    {
      name: "passes when the resource is missing and specific tags are present",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: undefined,
      expected: true,
    },
    {
      name: "fails when a weak candidate matches a strong current tag",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['W/"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "fails when a strong candidate matches a weak current tag",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:2"'],
      } satisfies EntityTagCondition,
      currentEntityTag: 'W/"graph-1:2"',
      expected: false,
    },
    {
      name: "fails when any candidate matches in a multi-tag list",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:1"', 'W/"graph-1:2"', '"graph-1:3"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: false,
    },
    {
      name: "passes when no candidate matches in a multi-tag list",
      precondition: {
        kind: "entity-tag-list",
        entityTags: ['"graph-1:1"', 'W/"graph-1:3"'],
      } satisfies EntityTagCondition,
      currentEntityTag: '"graph-1:2"',
      expected: true,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      assert.equal(
        etagSatisfiesIfNoneMatch(testCase.precondition, testCase.currentEntityTag),
        testCase.expected,
      );
    });
  }
});
