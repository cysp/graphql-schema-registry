import { createHash } from "node:crypto";

import { composeServices } from "@apollo/composition";
import {
  FEDERATION_VERSIONS,
  FeatureVersion,
  buildSubgraph,
  defaultPrintOptions,
  orderPrintedDefinitions,
  printSchema,
} from "@apollo/federation-internals";
import { GraphQLError, parse } from "graphql";

export type ValidatedSubgraphSchema = {
  normalizedHash: string;
  normalizedSdl: string;
};

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const federationVersionPattern = /^v[0-9]+\.[0-9]+$/;

export function isSupportedFederationVersion(value: string): boolean {
  if (!federationVersionPattern.test(value)) {
    return false;
  }

  try {
    const parsed = FeatureVersion.parse(value);
    return FEDERATION_VERSIONS.versions().some((knownVersion) => knownVersion.equals(parsed));
  } catch {
    return false;
  }
}

function parseFederationVersion(value: string): FeatureVersion {
  if (!federationVersionPattern.test(value)) {
    throw new Error(`Unsupported federation version format: ${value}`);
  }

  const parsed = FeatureVersion.parse(value);
  if (!FEDERATION_VERSIONS.versions().some((knownVersion) => knownVersion.equals(parsed))) {
    throw new Error(`Unsupported federation version: ${value}`);
  }

  return parsed;
}

function getEffectiveSubgraphFederationVersion(
  name: string,
  routingUrl: string,
  sdl: string,
): FeatureVersion | undefined {
  const subgraph = buildSubgraph(name, routingUrl, parse(sdl), true);
  const linkedFederationVersion = subgraph.metadata().federationFeature()?.url.version;
  if (!linkedFederationVersion) {
    return undefined;
  }

  const versionsFromFeatures: FeatureVersion[] = [];
  for (const feature of subgraph.schema.coreFeatures?.allFeatures() ?? []) {
    const version = feature.minimumFederationVersion();
    if (version) {
      versionsFromFeatures.push(version);
    }
  }

  const impliedFederationVersion = FeatureVersion.max(versionsFromFeatures);
  if (
    !impliedFederationVersion?.satisfies(linkedFederationVersion) ||
    linkedFederationVersion.gte(impliedFederationVersion)
  ) {
    return linkedFederationVersion;
  }

  return impliedFederationVersion;
}

export function validateSubgraphSchema(
  name: string,
  routingUrl: string,
  rawSdl: string,
): { ok: true; value: ValidatedSubgraphSchema } | { ok: false } {
  let document;
  try {
    document = parse(rawSdl);
  } catch {
    return { ok: false };
  }

  try {
    const subgraph = buildSubgraph(name, routingUrl, document, true);
    const printOptions = orderPrintedDefinitions({
      ...defaultPrintOptions,
      mergeTypesAndExtensions: true,
    });
    const normalizedSdl = normalizeNewlines(printSchema(subgraph.schema, printOptions));
    return {
      ok: true,
      value: {
        normalizedHash: sha256(normalizedSdl),
        normalizedSdl,
      },
    };
  } catch (error) {
    if (
      error instanceof GraphQLError ||
      (error instanceof Error && error.name === "GraphQLError")
    ) {
      return { ok: false };
    }

    throw error;
  }
}

export function composeSupergraph(input: {
  federationVersion: string;
  subgraphs: ReadonlyArray<{
    name: string;
    sdl: string;
    url: string;
  }>;
}):
  | {
      kind: "failure";
    }
  | {
      kind: "success";
      supergraphSdl: string;
    } {
  const targetFederationVersion = parseFederationVersion(input.federationVersion);
  const services = input.subgraphs
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((subgraph) => {
      const subgraphFederationVersion = getEffectiveSubgraphFederationVersion(
        subgraph.name,
        subgraph.url,
        subgraph.sdl,
      );
      if (
        subgraphFederationVersion &&
        !targetFederationVersion.satisfies(subgraphFederationVersion)
      ) {
        return [];
      }

      return [
        {
          name: subgraph.name,
          typeDefs: parse(subgraph.sdl),
          url: subgraph.url,
        },
      ];
    });

  if (services.length !== input.subgraphs.length) {
    return {
      kind: "failure",
    };
  }

  const result = composeServices(services, {
    runSatisfiability: true,
  });
  if (result.errors) {
    return {
      kind: "failure",
    };
  }
  if (!result.supergraphSdl) {
    return {
      kind: "failure",
    };
  }

  const supergraphSdl = normalizeNewlines(result.supergraphSdl);
  return {
    kind: "success",
    supergraphSdl,
  };
}
