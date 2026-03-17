import { emitOperationFile } from "./emit-operation-files.ts";
import { emitOperationIndexFile } from "./emit-operation-index.ts";
import { assertNoGeneratedOperationFilePathCollisions } from "./emit-shared.ts";
import type { GeneratedFile, NormalizedOperation } from "./types.ts";

export function emitGeneratedOpenApiFiles(
  operations: readonly NormalizedOperation[],
): GeneratedFile[] {
  assertNoGeneratedOperationFilePathCollisions(operations);

  return [
    ...operations.map((operation) => emitOperationFile(operation)),
    emitOperationIndexFile(operations),
  ];
}
