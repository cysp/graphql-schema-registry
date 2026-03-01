import type { IR } from "@hey-api/openapi-ts";

export type ResponseInfo = {
  schemaSymbol: string;
  status: string;
};

function toPascalCase(value: string): string {
  return value
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function getResponseStatuses(operation: IR.OperationObject): string[] {
  if (!operation.responses) {
    return [];
  }

  const statuses = Object.keys(operation.responses).filter((status) => {
    return operation.responses?.[status] !== undefined;
  });

  return statuses.toSorted((a, b) => {
    const aIsNumeric = /^[0-9]{3}$/.test(a);
    const bIsNumeric = /^[0-9]{3}$/.test(b);
    if (aIsNumeric && bIsNumeric) {
      return Number(a) - Number(b);
    }
    if (aIsNumeric) {
      return -1;
    }
    if (bIsNumeric) {
      return 1;
    }
    if (a === "default") {
      return 1;
    }
    if (b === "default") {
      return -1;
    }

    return a.localeCompare(b);
  });
}

function getSchemaSymbolFromRef(schemaRef: string | undefined): string | undefined {
  if (!schemaRef) {
    return undefined;
  }

  const schemaRefPrefix = "#/components/schemas/";
  if (!schemaRef.startsWith(schemaRefPrefix)) {
    return undefined;
  }

  const schemaName = schemaRef.slice(schemaRefPrefix.length);
  return schemaName ? `z${toPascalCase(schemaName)}` : undefined;
}

function getResponseSchemaSymbol(
  operationName: string,
  status: string,
  response: IR.ResponseObject | undefined,
  responseSchemaRef: string | undefined,
): string {
  const schemaSymbol = getSchemaSymbolFromRef(responseSchemaRef ?? response?.schema.$ref);
  if (schemaSymbol) {
    return schemaSymbol;
  }

  if (status.startsWith("2")) {
    return `z${operationName}Response`;
  }

  return "zRoot";
}

export function collectResponseInfos(
  operation: IR.OperationObject,
  responseSchemaRefsByStatus: Readonly<Record<string, string | undefined>>,
): ResponseInfo[] {
  const operationName = toPascalCase(operation.id);
  return getResponseStatuses(operation).map((status) => {
    return {
      schemaSymbol: getResponseSchemaSymbol(
        operationName,
        status,
        operation.responses?.[status],
        responseSchemaRefsByStatus[status],
      ),
      status,
    };
  });
}
