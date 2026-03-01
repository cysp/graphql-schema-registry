type OperationLike = {
  hasBody: boolean;
  hasHeaders: boolean;
  hasPath: boolean;
  hasQuery: boolean;
  id: string;
  responses: ReadonlyArray<{ schemaSymbol: string }>;
};

function toPascalCase(value: string): string {
  return value
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function getDataSymbol(operationId: string): string {
  return `z${toPascalCase(operationId)}Data`;
}

export function collectRequiredZodSymbols(operations: readonly OperationLike[]): string[] {
  const requiredSymbols = new Set<string>();

  for (const operation of operations) {
    if (operation.hasBody || operation.hasHeaders || operation.hasPath || operation.hasQuery) {
      requiredSymbols.add(getDataSymbol(operation.id));
    }

    for (const response of operation.responses) {
      requiredSymbols.add(response.schemaSymbol);
    }
  }

  return Array.from(requiredSymbols).toSorted();
}
