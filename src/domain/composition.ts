import { createHash } from "node:crypto";

import { composeServices } from "@apollo/composition";
import { parse, print } from "graphql";

import type { PostgresJsTransaction } from "../drizzle/types.ts";
import {
  clearCurrentGraphCompositionRevision,
  insertGraphComposition,
  selectLatestGraphCompositionRevision,
  selectGraphCompositionSchemaRevisions,
} from "./database/graph-compositions/repository.ts";
import {
  selectLatestSubgraphSchemaRevisions,
  selectSubgraphSchemaRevisions,
} from "./database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphsByGraphId } from "./database/subgraphs/repository.ts";
import type {
  ActiveGraph,
  ActiveSubgraph,
  StoredSubgraphSchemaRevision,
} from "./database/types.ts";

type CompositionCandidate = {
  schemaRevision: StoredSubgraphSchemaRevision;
  subgraph: ActiveSubgraph;
};

type CompositionSubgraphSelection = {
  schemaRevision: StoredSubgraphSchemaRevision;
  subgraph: ActiveSubgraph;
};

export type DryRunSubgraphSchemaPublishResult =
  | {
      diagnostics: string[];
      kind: "invalid";
    }
  | {
      diagnostics: string[];
      kind: "success";
    };

export type RecompositionResult =
  | {
      compositionRevision: number;
      diagnostics: string[];
      kind: "composed";
      selectedSchemaRevisions: Map<string, number>;
    }
  | {
      diagnostics: string[];
      kind: "not_composed";
      selectedSchemaRevisions: Map<string, number>;
    };

export function normalizeSchemaSdl(schemaSdl: string): string {
  return `${print(parse(schemaSdl)).trim()}\n`;
}

export function hashNormalizedSchemaSdl(normalizedSdl: string): string {
  return createHash("sha256").update(normalizedSdl).digest("hex");
}

function buildDiagnostics(messages: readonly { message: string }[]): string[] {
  return messages.map((message) => message.message);
}

function composeSelectedSubgraphs(selectedSubgraphs: CompositionSubgraphSelection[]): {
  diagnostics: string[];
  supergraphSdl?: string;
} {
  const missingSchemaSubgraphs = selectedSubgraphs
    .filter((subgraph) => subgraph.schemaRevision.normalizedSdl.trim() === "")
    .map((subgraph) => subgraph.subgraph.slug);
  if (missingSchemaSubgraphs.length > 0) {
    return {
      diagnostics: missingSchemaSubgraphs.map(
        (slug) => `Subgraph ${slug} has no schema available for composition.`,
      ),
    };
  }

  const services = selectedSubgraphs
    .toSorted((left, right) => left.subgraph.slug.localeCompare(right.subgraph.slug))
    .map((subgraph) => ({
      name: subgraph.subgraph.slug,
      typeDefs: parse(subgraph.schemaRevision.normalizedSdl),
      url: subgraph.subgraph.routingUrl,
    }));

  if (services.length === 0) {
    return {
      diagnostics: ["No published subgraph schemas are available for composition."],
    };
  }

  const result = composeServices(services, {
    runSatisfiability: true,
  });

  if ("errors" in result && result.errors) {
    return {
      diagnostics: buildDiagnostics(result.errors),
    };
  }

  return {
    diagnostics: result.hints.map((hint: { toString(): string }) => hint.toString()),
    supergraphSdl: result.supergraphSdl,
  };
}

function collectSelection(
  activeSubgraphs: ActiveSubgraph[],
  selectedSchemaRevisions: Map<string, StoredSubgraphSchemaRevision>,
): { diagnostics: string[]; selectedSubgraphs: CompositionSubgraphSelection[] } {
  const selectedSubgraphs: CompositionSubgraphSelection[] = [];
  const diagnostics: string[] = [];

  for (const subgraph of activeSubgraphs.toSorted((left, right) =>
    left.slug.localeCompare(right.slug),
  )) {
    const schemaRevision = selectedSchemaRevisions.get(subgraph.id);
    if (!schemaRevision) {
      diagnostics.push(`Subgraph ${subgraph.slug} has no active schema revision.`);
      continue;
    }

    selectedSubgraphs.push({
      subgraph,
      schemaRevision,
    });
  }

  return {
    diagnostics,
    selectedSubgraphs,
  };
}

export async function loadActiveSchemaRevisionMap(
  transaction: PostgresJsTransaction,
  graph: ActiveGraph,
): Promise<Map<string, StoredSubgraphSchemaRevision>> {
  if (graph.currentGraphCompositionRevision === null) {
    return new Map();
  }

  const activeSchemaRevisions = await selectGraphCompositionSchemaRevisions(
    transaction,
    graph.id,
    graph.currentGraphCompositionRevision,
  );
  return selectSubgraphSchemaRevisions(
    transaction,
    Array.from(activeSchemaRevisions, ([subgraphId, revision]) => ({
      subgraphId,
      revision,
    })),
  );
}

export async function attemptRecomposeGraph(
  transaction: PostgresJsTransaction,
  graph: ActiveGraph,
  now: Date,
): Promise<RecompositionResult> {
  const activeSubgraphs = await selectActiveSubgraphsByGraphId(transaction, graph.id);
  const activeSchemaMap = await loadActiveSchemaRevisionMap(transaction, graph);
  const selectedSchemaRevisions = new Map(activeSchemaMap);
  const latestCandidates: CompositionCandidate[] = [];
  const latestSchemaRevisions = await selectLatestSubgraphSchemaRevisions(
    transaction,
    activeSubgraphs.map((subgraph) => subgraph.id),
  );

  for (const subgraph of activeSubgraphs) {
    const latestSchemaRevision = latestSchemaRevisions.get(subgraph.id);
    if (!latestSchemaRevision) {
      continue;
    }

    const activeSchemaRevision = activeSchemaMap.get(subgraph.id);
    if (!activeSchemaRevision || latestSchemaRevision.revision > activeSchemaRevision.revision) {
      latestCandidates.push({
        schemaRevision: latestSchemaRevision,
        subgraph,
      });
    }
  }

  const diagnosticsBySubgraph = new Map<string, string[]>();

  for (;;) {
    let promotedInPass = false;

    for (const candidate of latestCandidates.toSorted((left, right) =>
      left.subgraph.slug.localeCompare(right.subgraph.slug),
    )) {
      if (
        selectedSchemaRevisions.get(candidate.subgraph.id)?.revision ===
        candidate.schemaRevision.revision
      ) {
        diagnosticsBySubgraph.delete(candidate.subgraph.id);
        continue;
      }

      const candidateSchemaMap = new Map([
        ...selectedSchemaRevisions,
        [candidate.subgraph.id, candidate.schemaRevision] as const,
      ]);
      const { diagnostics: missingSchemaDiagnostics, selectedSubgraphs } = collectSelection(
        activeSubgraphs,
        candidateSchemaMap,
      );
      const compositionAttempt = composeSelectedSubgraphs(selectedSubgraphs);
      const diagnostics = [...missingSchemaDiagnostics, ...compositionAttempt.diagnostics];

      if (compositionAttempt.supergraphSdl) {
        selectedSchemaRevisions.set(candidate.subgraph.id, candidate.schemaRevision);
        diagnosticsBySubgraph.delete(candidate.subgraph.id);
        promotedInPass = true;
      } else {
        diagnosticsBySubgraph.set(candidate.subgraph.id, diagnostics);
      }
    }

    if (!promotedInPass) {
      break;
    }
  }

  const { diagnostics: missingSchemaDiagnostics, selectedSubgraphs } = collectSelection(
    activeSubgraphs,
    selectedSchemaRevisions,
  );
  const finalComposition = composeSelectedSubgraphs(selectedSubgraphs);
  const finalDiagnostics = [
    ...missingSchemaDiagnostics,
    ...Array.from(diagnosticsBySubgraph.values()).flat(),
    ...finalComposition.diagnostics,
  ];

  if (!finalComposition.supergraphSdl) {
    await clearCurrentGraphCompositionRevision(transaction, graph.id);
    return {
      kind: "not_composed",
      diagnostics: Array.from(new Set(finalDiagnostics)),
      selectedSchemaRevisions: new Map(
        Array.from(selectedSchemaRevisions.entries(), ([subgraphId, revision]) => [
          subgraphId,
          revision.revision,
        ]),
      ),
    };
  }

  const compositionRevision = await selectLatestGraphCompositionRevision(transaction, graph.id);
  await insertGraphComposition(transaction, {
    graphId: graph.id,
    revision: compositionRevision,
    supergraphSdl: finalComposition.supergraphSdl,
    compositionHash: hashNormalizedSchemaSdl(finalComposition.supergraphSdl),
    createdAt: now,
    graphRevision: graph.currentRevision,
    subgraphs: selectedSubgraphs.map((subgraph) => ({
      subgraphId: subgraph.subgraph.id,
      subgraphRevision: subgraph.subgraph.currentRevision,
      subgraphSchemaRevision: subgraph.schemaRevision.revision,
    })),
  });

  return {
    kind: "composed",
    compositionRevision,
    diagnostics: Array.from(new Set(finalDiagnostics)),
    selectedSchemaRevisions: new Map(
      selectedSubgraphs.map(
        (subgraph) => [subgraph.subgraph.id, subgraph.schemaRevision.revision] as const,
      ),
    ),
  };
}

export async function dryRunSubgraphSchemaComposition(
  activeSubgraphs: ActiveSubgraph[],
  targetSubgraphId: string,
  normalizedSdl: string,
  existingSelections: Map<string, StoredSubgraphSchemaRevision>,
): Promise<DryRunSubgraphSchemaPublishResult> {
  const targetSubgraph = activeSubgraphs.find((subgraph) => subgraph.id === targetSubgraphId);
  if (!targetSubgraph) {
    return {
      kind: "invalid",
      diagnostics: ["Subgraph not found."],
    };
  }

  const selectedSchemas = new Map([
    ...existingSelections,
    [
      targetSubgraphId,
      {
        subgraphId: targetSubgraphId,
        revision: Number.MAX_SAFE_INTEGER,
        normalizedHash: hashNormalizedSchemaSdl(normalizedSdl),
        normalizedSdl,
        createdAt: new Date(0),
      },
    ] as const,
  ]);

  const { diagnostics: missingSchemaDiagnostics, selectedSubgraphs } = collectSelection(
    activeSubgraphs,
    selectedSchemas,
  );
  const composition = composeSelectedSubgraphs(selectedSubgraphs);
  if (!composition.supergraphSdl) {
    return {
      kind: "invalid",
      diagnostics: [...missingSchemaDiagnostics, ...composition.diagnostics],
    };
  }

  return {
    kind: "success",
    diagnostics: [...missingSchemaDiagnostics, ...composition.diagnostics],
  };
}
