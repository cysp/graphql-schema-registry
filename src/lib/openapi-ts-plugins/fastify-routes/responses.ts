import type { IR } from "@hey-api/openapi-ts";

export type ResponseInfo = {
  schemaSymbol: string;
  status: string;
};

type ResponseEntry = {
  response: IR.ResponseObject;
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

function getResponseEntries(operation: IR.OperationObject): ResponseEntry[] {
  return getResponseStatuses(operation).map((status) => {
    const response = operation.responses?.[status];
    if (!response) {
      throw new Error(
        `Response entry for operation "${operation.id}" status "${status}" is undefined.`,
      );
    }

    return { response, status };
  });
}

function getSchemaSymbolFromRef(schemaRef: string | undefined): string | undefined {
  if (!schemaRef) {
    return undefined;
  }

  const schemaRefPrefix = "#/components/schemas/";
  if (!schemaRef.startsWith(schemaRefPrefix)) {
    throw new Error(
      `Unsupported response schema ref "${schemaRef}". Only "#/components/schemas/*" refs are supported.`,
    );
  }

  const schemaName = schemaRef.slice(schemaRefPrefix.length);
  return schemaName ? `z${toPascalCase(schemaName)}` : undefined;
}

function resolveResponseSchemaSymbol(
  operationName: string,
  operationId: string,
  entry: ResponseEntry,
): { schemaSymbol: string; usesOperationResponseSymbol: boolean } {
  const schema = entry.response.schema;
  const schemaSymbol = getSchemaSymbolFromRef(schema.$ref);
  if (schemaSymbol) {
    return { schemaSymbol, usesOperationResponseSymbol: false };
  }

  if (schema.type === "unknown") {
    return { schemaSymbol: "zRoot", usesOperationResponseSymbol: false };
  }

  if (schema.type === "void" || entry.status.startsWith("2")) {
    return { schemaSymbol: `z${operationName}Response`, usesOperationResponseSymbol: true };
  }

  throw new Error(
    `Unable to resolve response schema symbol for operation "${operationId}" status "${entry.status}" (schema type: "${schema.type ?? "undefined"}").`,
  );
}

function ensureOperationResponseSymbolIsUnambiguous(
  operationId: string,
  operationName: string,
  statusesUsingOperationResponseSymbol: readonly string[],
): void {
  if (statusesUsingOperationResponseSymbol.length <= 1) {
    return;
  }

  throw new Error(
    `Operation "${operationId}" has multiple responses that would map to z${operationName}Response (${statusesUsingOperationResponseSymbol.join(", ")}). Define component schemas for those responses to make mapping unambiguous.`,
  );
}

export function collectResponseInfos(operation: IR.OperationObject): ResponseInfo[] {
  const operationName = toPascalCase(operation.id);
  const statusesUsingOperationResponseSymbol: string[] = [];
  const responseInfos = getResponseEntries(operation).map((entry) => {
    const { schemaSymbol, usesOperationResponseSymbol } = resolveResponseSchemaSymbol(
      operationName,
      operation.id,
      entry,
    );

    if (usesOperationResponseSymbol) {
      statusesUsingOperationResponseSymbol.push(entry.status);
    }

    return {
      schemaSymbol,
      status: entry.status,
    };
  });

  ensureOperationResponseSymbolIsUnambiguous(
    operation.id,
    operationName,
    statusesUsingOperationResponseSymbol,
  );

  return responseInfos;
}
