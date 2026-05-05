import type { StoredSupergraphSchema } from "./database/types.ts";
import { formatStrongETag, parseIfMatchHeader, parseResourceRevisionEntityTag } from "./etag.ts";

export type SupergraphSchemaSnapshot = {
  etag: string;
  graphId: string;
  compositionRevision: bigint;
  supergraphSdl: string;
};

export type SupergraphSchemaStreamCursor = {
  lastSeenRevision: bigint | undefined;
  lastSentEtag: string | undefined;
};

type SseWritable = {
  destroyed?: boolean | undefined;
  once(event: string, listener: (...args: unknown[]) => void): SseWritable;
  removeListener(event: string, listener: (...args: unknown[]) => void): SseWritable;
  writableEnded?: boolean | undefined;
  write(chunk: string): boolean;
};

async function waitForDrain(writable: SseWritable): Promise<void> {
  if (writable.destroyed || writable.writableEnded) {
    throw new Error("SSE response closed before write drain.");
  }

  return new Promise<void>((resolve, reject) => {
    let onClose!: () => void;
    let onDrain!: () => void;
    let onError!: (error: unknown) => void;
    let onFinish!: () => void;

    const cleanup = (): void => {
      writable.removeListener("close", onClose);
      writable.removeListener("drain", onDrain);
      writable.removeListener("error", onError);
      writable.removeListener("finish", onFinish);
    };

    onClose = (): void => {
      cleanup();
      reject(new Error("SSE response closed before write drain."));
    };

    onDrain = (): void => {
      cleanup();
      resolve();
    };

    onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    onFinish = (): void => {
      cleanup();
      reject(new Error("SSE response finished before write drain."));
    };

    writable.once("close", onClose);
    writable.once("drain", onDrain);
    writable.once("error", onError);
    writable.once("finish", onFinish);
  });
}

async function writeSseChunk(writable: SseWritable, chunk: string): Promise<void> {
  if (writable.destroyed || writable.writableEnded) {
    throw new Error("SSE response is no longer writable.");
  }

  if (writable.write(chunk)) {
    return;
  }

  await waitForDrain(writable);
}

export function formatSupergraphSchemaSnapshot(
  snapshot: StoredSupergraphSchema,
): SupergraphSchemaSnapshot {
  return {
    compositionRevision: snapshot.compositionRevision,
    etag: formatStrongETag(snapshot.graphId, snapshot.compositionRevision),
    graphId: snapshot.graphId,
    supergraphSdl: snapshot.supergraphSdl,
  };
}

export function resolveSupergraphSchemaStreamCursor(
  lastEventIdHeader: string | string[] | undefined,
  graphId: string,
): SupergraphSchemaStreamCursor {
  const condition = parseIfMatchHeader(lastEventIdHeader);
  if (condition === undefined) {
    return {
      lastSeenRevision: undefined,
      lastSentEtag: undefined,
    };
  }

  if (condition.kind === "wildcard" || condition.entityTags.length !== 1) {
    throw new Error("Last-Event-ID must be a single entity-tag value.");
  }

  const [entityTag] = condition.entityTags;
  if (entityTag === undefined) {
    throw new Error("Last-Event-ID must be a single entity-tag value.");
  }

  const parsedEntityTag = parseResourceRevisionEntityTag(entityTag);
  if (!parsedEntityTag || parsedEntityTag.weak) {
    throw new Error("Last-Event-ID must be a single strong entity-tag value.");
  }

  if (parsedEntityTag.resourceId !== graphId) {
    return {
      lastSeenRevision: undefined,
      lastSentEtag: undefined,
    };
  }

  return {
    lastSeenRevision: parsedEntityTag.revision,
    lastSentEtag: entityTag,
  };
}

export async function writeSupergraphSchemaSseEvent(
  writable: SseWritable,
  eventId: string,
  sdl: string,
): Promise<void> {
  const lines = [`id: ${eventId}`, "event: schema"];
  for (const line of sdl.split(/\r?\n/u)) {
    lines.push(`data: ${line}`);
  }
  lines.push("", "");

  await writeSseChunk(writable, lines.join("\n"));
}

export async function writeSupergraphSchemaSseHeartbeat(writable: SseWritable): Promise<void> {
  await writeSseChunk(writable, ": heartbeat\n\n");
}
