export const supergraphSchemaUpdatesChannel = "supergraph_schema_updates";

export type SupergraphSchemaUpdatedNotification = {
  compositionRevision: bigint;
  graphId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function encodeSupergraphSchemaUpdatedNotification(
  notification: SupergraphSchemaUpdatedNotification,
): string {
  return JSON.stringify({
    compositionRevision: String(notification.compositionRevision),
    graphId: notification.graphId,
  });
}

export function decodeSupergraphSchemaUpdatedNotification(
  payload: string,
): SupergraphSchemaUpdatedNotification | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const graphId = parsed["graphId"];
  const compositionRevision = parsed["compositionRevision"];

  if (typeof graphId !== "string" || typeof compositionRevision !== "string") {
    return undefined;
  }

  try {
    return {
      compositionRevision: BigInt(compositionRevision),
      graphId,
    };
  } catch {
    return undefined;
  }
}
