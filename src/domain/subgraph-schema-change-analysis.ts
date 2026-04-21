import {
  findBreakingChanges,
  findDangerousChanges,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isRequiredArgument,
  isSpecifiedDirective,
  isSpecifiedScalarType,
  isUnionType,
  type GraphQLError,
  type GraphQLNamedType,
  type GraphQLSchema,
} from "graphql";

export type ClassifiedSchemaChange = {
  type: string;
  message: string;
};

export type SchemaChange = ClassifiedSchemaChange & {
  severity: "breaking" | "dangerous" | "safe";
};

export type CompositionError = {
  message: string;
  code?: string;
};

export type ValidateSubgraphSchemaSummary = {
  totalChanges: number;
  breakingChanges: number;
  dangerousChanges: number;
  safeChanges: number;
  compositionErrors: number;
};

export type ValidateSubgraphSchemaAnalysis = {
  composed: boolean;
  baselineAvailable: boolean;
  summary: ValidateSubgraphSchemaSummary;
  changes: SchemaChange[];
  breakingChanges: ClassifiedSchemaChange[];
  dangerousChanges: ClassifiedSchemaChange[];
  compositionErrors: CompositionError[];
};

function compareClassifiedSchemaChanges(
  left: ClassifiedSchemaChange,
  right: ClassifiedSchemaChange,
): number {
  return left.type.localeCompare(right.type) || left.message.localeCompare(right.message);
}

const severityRank: Record<SchemaChange["severity"], number> = {
  breaking: 0,
  dangerous: 1,
  safe: 2,
};

function compareSchemaChanges(left: SchemaChange, right: SchemaChange): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    compareClassifiedSchemaChanges(left, right)
  );
}

function isVisibleType(type: GraphQLNamedType): boolean {
  return !type.name.startsWith("__") && !isSpecifiedScalarType(type);
}

function uniqueClassifiedSchemaChanges(
  changes: ReadonlyArray<ClassifiedSchemaChange>,
): ClassifiedSchemaChange[] {
  const uniqueChangesByKey = new Map<string, ClassifiedSchemaChange>();

  for (const change of changes) {
    const key = `${change.type}\u0000${change.message}`;
    if (!uniqueChangesByKey.has(key)) {
      uniqueChangesByKey.set(key, change);
    }
  }

  return Array.from(uniqueChangesByKey.values()).toSorted(compareClassifiedSchemaChanges);
}

function collectTypeMemberAdditions(
  type: GraphQLNamedType,
  changes: ClassifiedSchemaChange[],
): void {
  if (isObjectType(type) || isInterfaceType(type)) {
    for (const fieldName of Object.keys(type.getFields()).toSorted()) {
      changes.push({
        type: "FIELD_ADDED",
        message: `${type.name}.${fieldName} was added.`,
      });
    }
    return;
  }

  if (isInputObjectType(type)) {
    for (const fieldName of Object.keys(type.getFields()).toSorted()) {
      changes.push({
        type: "INPUT_FIELD_ADDED",
        message: `${type.name}.${fieldName} was added.`,
      });
    }
    return;
  }

  if (isEnumType(type)) {
    for (const enumValue of type.getValues().toSorted((left, right) => left.name.localeCompare(right.name))) {
      changes.push({
        type: "ENUM_VALUE_ADDED",
        message: `${enumValue.name} was added to enum type ${type.name}.`,
      });
    }
    return;
  }

  if (isUnionType(type)) {
    for (const memberType of type.getTypes().toSorted((left, right) => left.name.localeCompare(right.name))) {
      changes.push({
        type: "UNION_MEMBER_ADDED",
        message: `${memberType.name} was added to union type ${type.name}.`,
      });
    }
  }
}

function collectSafeAdditionChanges(
  baselineSchema: GraphQLSchema,
  candidateSchema: GraphQLSchema,
): ClassifiedSchemaChange[] {
  const changes: ClassifiedSchemaChange[] = [];

  const baselineTypes = baselineSchema.getTypeMap();
  const candidateTypes = candidateSchema.getTypeMap();

  for (const candidateTypeName of Object.keys(candidateTypes).toSorted()) {
    const candidateType = candidateTypes[candidateTypeName];
    if (!candidateType || !isVisibleType(candidateType)) {
      continue;
    }

    const baselineType = baselineTypes[candidateTypeName];

    if (!baselineType) {
      changes.push({
        type: "TYPE_ADDED",
        message: `${candidateType.name} was added.`,
      });
      collectTypeMemberAdditions(candidateType, changes);
      continue;
    }

    if (isObjectType(candidateType) && isObjectType(baselineType)) {
      const baselineFields = baselineType.getFields();
      const candidateFields = candidateType.getFields();

      for (const fieldName of Object.keys(candidateFields).toSorted()) {
        if (!baselineFields[fieldName]) {
          changes.push({
            type: "FIELD_ADDED",
            message: `${candidateType.name}.${fieldName} was added.`,
          });
        }
      }
      continue;
    }

    if (isInterfaceType(candidateType) && isInterfaceType(baselineType)) {
      const baselineFields = baselineType.getFields();
      const candidateFields = candidateType.getFields();

      for (const fieldName of Object.keys(candidateFields).toSorted()) {
        if (!baselineFields[fieldName]) {
          changes.push({
            type: "FIELD_ADDED",
            message: `${candidateType.name}.${fieldName} was added.`,
          });
        }
      }
    }
  }

  const baselineDirectives = new Map(
    baselineSchema
      .getDirectives()
      .filter((directive) => !isSpecifiedDirective(directive))
      .map((directive) => [directive.name, directive] as const),
  );
  const candidateDirectives = candidateSchema
    .getDirectives()
    .filter((directive) => !isSpecifiedDirective(directive))
    .toSorted((left, right) => left.name.localeCompare(right.name));

  for (const candidateDirective of candidateDirectives) {
    const baselineDirective = baselineDirectives.get(candidateDirective.name);

    if (!baselineDirective) {
      changes.push({
        type: "DIRECTIVE_ADDED",
        message: `${candidateDirective.name} was added.`,
      });

      for (const argument of candidateDirective.args.toSorted((left, right) => left.name.localeCompare(right.name))) {
        changes.push({
          type: "DIRECTIVE_ARG_ADDED",
          message: `${argument.name} was added to ${candidateDirective.name}.`,
        });
      }

      continue;
    }

    const baselineDirectiveArgs = new Set(baselineDirective.args.map((argument) => argument.name));

    for (const argument of candidateDirective.args.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (!baselineDirectiveArgs.has(argument.name) && !isRequiredArgument(argument)) {
        changes.push({
          type: "DIRECTIVE_ARG_ADDED",
          message: `${argument.name} was added to ${candidateDirective.name}.`,
        });
      }
    }
  }

  return uniqueClassifiedSchemaChanges(changes);
}

function collectAdditionsFromEmptySchema(candidateSchema: GraphQLSchema): ClassifiedSchemaChange[] {
  const changes: ClassifiedSchemaChange[] = [];

  for (const candidateTypeName of Object.keys(candidateSchema.getTypeMap()).toSorted()) {
    const candidateType = candidateSchema.getTypeMap()[candidateTypeName];
    if (!candidateType || !isVisibleType(candidateType)) {
      continue;
    }

    changes.push({
      type: "TYPE_ADDED",
      message: `${candidateType.name} was added.`,
    });

    collectTypeMemberAdditions(candidateType, changes);
  }

  for (const candidateDirective of candidateSchema
    .getDirectives()
    .filter((directive) => !isSpecifiedDirective(directive))
    .toSorted((left, right) => left.name.localeCompare(right.name))) {
    changes.push({
      type: "DIRECTIVE_ADDED",
      message: `${candidateDirective.name} was added.`,
    });

    for (const argument of candidateDirective.args.toSorted((left, right) => left.name.localeCompare(right.name))) {
      changes.push({
        type: "DIRECTIVE_ARG_ADDED",
        message: `${argument.name} was added to ${candidateDirective.name}.`,
      });
    }
  }

  return uniqueClassifiedSchemaChanges(changes);
}

function createSummary({
  breakingChanges,
  dangerousChanges,
  safeChanges,
  compositionErrors,
}: {
  breakingChanges: number;
  dangerousChanges: number;
  safeChanges: number;
  compositionErrors: number;
}): ValidateSubgraphSchemaSummary {
  return {
    totalChanges: breakingChanges + dangerousChanges + safeChanges,
    breakingChanges,
    dangerousChanges,
    safeChanges,
    compositionErrors,
  };
}

function mapToClassifiedChanges(
  changes: ReadonlyArray<{ description: string; type: string }>,
): ClassifiedSchemaChange[] {
  return changes
    .map((change) => ({
      type: change.type,
      message: change.description,
    }))
    .toSorted(compareClassifiedSchemaChanges);
}

function mapToSchemaChanges(
  severity: SchemaChange["severity"],
  changes: ReadonlyArray<ClassifiedSchemaChange>,
): SchemaChange[] {
  return changes.map((change) => ({
    severity,
    ...change,
  }));
}

export function normalizeCompositionErrors(
  errors: ReadonlyArray<GraphQLError>,
): CompositionError[] {
  return errors
    .map((error) => {
      const code = error.extensions["code"];

      return {
        message: error.message,
        ...(typeof code === "string" ? { code } : {}),
      };
    })
    .toSorted(
      (left, right) =>
        left.message.localeCompare(right.message) ||
        (left.code ?? "").localeCompare(right.code ?? ""),
    );
}

export function createCompositionFailureAnalysis({
  baselineAvailable,
  compositionErrors,
}: {
  baselineAvailable: boolean;
  compositionErrors: ReadonlyArray<CompositionError>;
}): ValidateSubgraphSchemaAnalysis {
  return {
    composed: false,
    baselineAvailable,
    summary: createSummary({
      breakingChanges: 0,
      dangerousChanges: 0,
      safeChanges: 0,
      compositionErrors: compositionErrors.length,
    }),
    changes: [],
    breakingChanges: [],
    dangerousChanges: [],
    compositionErrors: [...compositionErrors],
  };
}

export function analyzeComposedSchemaChanges({
  baselineSchema,
  candidateSchema,
}: {
  baselineSchema: GraphQLSchema | undefined;
  candidateSchema: GraphQLSchema;
}): ValidateSubgraphSchemaAnalysis {
  if (!baselineSchema) {
    const safeChanges = collectAdditionsFromEmptySchema(candidateSchema);

    return {
      composed: true,
      baselineAvailable: false,
      summary: createSummary({
        breakingChanges: 0,
        dangerousChanges: 0,
        safeChanges: safeChanges.length,
        compositionErrors: 0,
      }),
      changes: mapToSchemaChanges("safe", safeChanges).toSorted(compareSchemaChanges),
      breakingChanges: [],
      dangerousChanges: [],
      compositionErrors: [],
    };
  }

  const breakingChanges = mapToClassifiedChanges(findBreakingChanges(baselineSchema, candidateSchema));
  const dangerousChanges = mapToClassifiedChanges(
    findDangerousChanges(baselineSchema, candidateSchema),
  );
  const safeChanges = collectSafeAdditionChanges(baselineSchema, candidateSchema);

  return {
    composed: true,
    baselineAvailable: true,
    summary: createSummary({
      breakingChanges: breakingChanges.length,
      dangerousChanges: dangerousChanges.length,
      safeChanges: safeChanges.length,
      compositionErrors: 0,
    }),
    changes: [
      ...mapToSchemaChanges("breaking", breakingChanges),
      ...mapToSchemaChanges("dangerous", dangerousChanges),
      ...mapToSchemaChanges("safe", safeChanges),
    ].toSorted(compareSchemaChanges),
    breakingChanges,
    dangerousChanges,
    compositionErrors: [],
  };
}
