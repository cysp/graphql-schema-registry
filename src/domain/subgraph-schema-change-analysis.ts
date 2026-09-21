import { isDeepStrictEqual } from "node:util";

import {
  BreakingChangeType,
  DangerousChangeType,
  findBreakingChanges,
  findDangerousChanges,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isRequiredInputField,
  isRequiredArgument,
  isSpecifiedDirective,
  isSpecifiedScalarType,
  isUnionType,
  parseSchemaCoordinate,
  resolveSchemaCoordinate,
  type BreakingChange,
  type DangerousChange,
  type GraphQLError,
  type GraphQLNamedType,
  type GraphQLSchema,
} from "graphql";

export type SchemaChange = {
  coordinate: string;
  severity: "breaking" | "dangerous" | "safe";
  type: string;
  message: string;
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
  summary: ValidateSubgraphSchemaSummary;
  changes: SchemaChange[];
  compositionErrors: CompositionError[];
};

type SchemaChangeBase = Omit<SchemaChange, "severity">;
type GraphqlSchemaChange = BreakingChange | DangerousChange;
type SupportedGraphqlSchemaChangeType = BreakingChangeType | DangerousChangeType;
type CoordinateDeriver = (change: GraphqlSchemaChange) => string;

type CoordinateValidationMode = "baseline_or_candidate" | "candidate_only";

export class SchemaCoordinateDerivationError extends Error {
  public readonly changeType: string;
  public readonly changeDescription: string;
  public readonly coordinate: string | undefined;

  public constructor({
    changeType,
    changeDescription,
    coordinate,
    message,
    cause,
  }: {
    changeType: string;
    changeDescription: string;
    coordinate?: string;
    message: string;
    cause?: unknown;
  }) {
    super(message, { cause });
    this.name = "SchemaCoordinateDerivationError";
    this.changeType = changeType;
    this.changeDescription = changeDescription;
    this.coordinate = coordinate;
  }
}

const severityRank: Record<SchemaChange["severity"], number> = {
  breaking: 0,
  dangerous: 1,
  safe: 2,
};

function compareSchemaChanges(left: SchemaChange, right: SchemaChange): number {
  return (
    left.coordinate.localeCompare(right.coordinate) ||
    severityRank[left.severity] - severityRank[right.severity] ||
    left.type.localeCompare(right.type) ||
    left.message.localeCompare(right.message)
  );
}

function compareSchemaChangeBase(left: SchemaChangeBase, right: SchemaChangeBase): number {
  return (
    left.coordinate.localeCompare(right.coordinate) ||
    left.type.localeCompare(right.type) ||
    left.message.localeCompare(right.message)
  );
}

function isVisibleType(type: GraphQLNamedType): boolean {
  return !type.name.startsWith("__") && !isSpecifiedScalarType(type);
}

function uniqueSchemaChangeBases(changes: ReadonlyArray<SchemaChangeBase>): SchemaChangeBase[] {
  const uniqueChangesByKey = new Map<string, SchemaChangeBase>();

  for (const change of changes) {
    const key = `${change.coordinate}\u0000${change.type}\u0000${change.message}`;
    if (!uniqueChangesByKey.has(key)) {
      uniqueChangesByKey.set(key, change);
    }
  }

  return Array.from(uniqueChangesByKey.values()).toSorted(compareSchemaChangeBase);
}

function collectTypeMemberAdditions(type: GraphQLNamedType, changes: SchemaChangeBase[]): void {
  if (isObjectType(type) || isInterfaceType(type)) {
    for (const fieldName of Object.keys(type.getFields()).toSorted()) {
      changes.push({
        coordinate: `${type.name}.${fieldName}`,
        type: "FIELD_ADDED",
        message: `${type.name}.${fieldName} was added.`,
      });
    }
    return;
  }

  if (isInputObjectType(type)) {
    for (const fieldName of Object.keys(type.getFields()).toSorted()) {
      changes.push({
        coordinate: `${type.name}.${fieldName}`,
        type: "INPUT_FIELD_ADDED",
        message: `${type.name}.${fieldName} was added.`,
      });
    }
    return;
  }

  if (isEnumType(type)) {
    for (const enumValue of type
      .getValues()
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      changes.push({
        coordinate: `${type.name}.${enumValue.name}`,
        type: "ENUM_VALUE_ADDED",
        message: `${enumValue.name} was added to enum type ${type.name}.`,
      });
    }
    return;
  }

  if (isUnionType(type)) {
    for (const memberType of type
      .getTypes()
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      changes.push({
        coordinate: type.name,
        type: "UNION_MEMBER_ADDED",
        message: `${memberType.name} was added to union type ${type.name}.`,
      });
    }
  }
}

function collectSafeAdditionChanges(
  baselineSchema: GraphQLSchema,
  candidateSchema: GraphQLSchema,
): SchemaChangeBase[] {
  const changes: SchemaChangeBase[] = [];

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
        coordinate: candidateType.name,
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
            coordinate: `${candidateType.name}.${fieldName}`,
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
            coordinate: `${candidateType.name}.${fieldName}`,
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
        coordinate: `@${candidateDirective.name}`,
        type: "DIRECTIVE_ADDED",
        message: `${candidateDirective.name} was added.`,
      });

      for (const argument of candidateDirective.args.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        changes.push({
          coordinate: `@${candidateDirective.name}(${argument.name}:)`,
          type: "DIRECTIVE_ARG_ADDED",
          message: `${argument.name} was added to ${candidateDirective.name}.`,
        });
      }

      continue;
    }

    const baselineDirectiveArgs = new Set(baselineDirective.args.map((argument) => argument.name));

    for (const argument of candidateDirective.args.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!baselineDirectiveArgs.has(argument.name) && !isRequiredArgument(argument)) {
        changes.push({
          coordinate: `@${candidateDirective.name}(${argument.name}:)`,
          type: "DIRECTIVE_ARG_ADDED",
          message: `${argument.name} was added to ${candidateDirective.name}.`,
        });
      }
    }
  }

  return uniqueSchemaChangeBases(changes);
}

function collectAdditionsFromEmptySchema(candidateSchema: GraphQLSchema): SchemaChangeBase[] {
  const changes: SchemaChangeBase[] = [];

  for (const candidateTypeName of Object.keys(candidateSchema.getTypeMap()).toSorted()) {
    const candidateType = candidateSchema.getTypeMap()[candidateTypeName];
    if (!candidateType || !isVisibleType(candidateType)) {
      continue;
    }

    changes.push({
      coordinate: candidateType.name,
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
      coordinate: `@${candidateDirective.name}`,
      type: "DIRECTIVE_ADDED",
      message: `${candidateDirective.name} was added.`,
    });

    for (const argument of candidateDirective.args.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      changes.push({
        coordinate: `@${candidateDirective.name}(${argument.name}:)`,
        type: "DIRECTIVE_ARG_ADDED",
        message: `${argument.name} was added to ${candidateDirective.name}.`,
      });
    }
  }

  return uniqueSchemaChangeBases(changes);
}

function mustMatch(match: RegExpMatchArray | null, change: GraphqlSchemaChange): RegExpMatchArray {
  if (!match) {
    throw new SchemaCoordinateDerivationError({
      changeType: change.type,
      changeDescription: change.description,
      message: `Unable to derive schema coordinate for ${change.type}: ${change.description}`,
    });
  }

  return match;
}

function requireGroup(
  match: RegExpMatchArray,
  groupName: string,
  change: GraphqlSchemaChange,
  context: string,
): string {
  const value = match.groups?.[groupName];
  if (!value) {
    throw new SchemaCoordinateDerivationError({
      changeType: change.type,
      changeDescription: change.description,
      message: `Unable to derive ${context} coordinate for ${change.type}: ${change.description}`,
    });
  }

  return value;
}

function toFieldCoordinateFromDescription(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^(?<typeName>[_A-Za-z][_0-9A-Za-z]*)\.(?<fieldName>[_A-Za-z][_0-9A-Za-z]*)/,
    ),
    change,
  );

  const typeName = requireGroup(match, "typeName", change, "field");
  const fieldName = requireGroup(match, "fieldName", change, "field");
  return `${typeName}.${fieldName}`;
}

function toFieldArgumentCoordinateFromDescription(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^(?<typeName>[_A-Za-z][_0-9A-Za-z]*)\.(?<fieldName>[_A-Za-z][_0-9A-Za-z]*) arg (?<argName>[_A-Za-z][_0-9A-Za-z]*) /,
    ),
    change,
  );

  const typeName = requireGroup(match, "typeName", change, "field argument");
  const fieldName = requireGroup(match, "fieldName", change, "field argument");
  const argName = requireGroup(match, "argName", change, "field argument");
  return `${typeName}.${fieldName}(${argName}:)`;
}

function deriveTypeRemovedCoordinate(change: GraphqlSchemaChange): string {
  const standardScalarMatch = change.description.match(
    /^Standard scalar (?<typeName>[_A-Za-z][_0-9A-Za-z]*) was removed/,
  );
  const standardScalarTypeName = standardScalarMatch?.groups?.["typeName"];
  if (standardScalarTypeName) {
    return standardScalarTypeName;
  }

  const match = mustMatch(
    change.description.match(/^(?<typeName>[_A-Za-z][_0-9A-Za-z]*) was removed\.$/),
    change,
  );
  return requireGroup(match, "typeName", change, "type");
}

function deriveTypeChangedKindCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(/^(?<typeName>[_A-Za-z][_0-9A-Za-z]*) changed from /),
    change,
  );
  return requireGroup(match, "typeName", change, "type");
}

function deriveUnionCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^[^ ]+ was (?:removed from|added to) union type (?<unionName>[_A-Za-z][_0-9A-Za-z]*)\.$/,
    ),
    change,
  );
  return requireGroup(match, "unionName", change, "union");
}

function deriveEnumValueCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^(?<valueName>[_A-Za-z][_0-9A-Za-z]*) was (?:removed from|added to) enum type (?<enumName>[_A-Za-z][_0-9A-Za-z]*)\.$/,
    ),
    change,
  );
  const enumName = requireGroup(match, "enumName", change, "enum value");
  const valueName = requireGroup(match, "valueName", change, "enum value");
  return `${enumName}.${valueName}`;
}

function deriveInputFieldCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^An? (?:required|optional) field (?<fieldName>[_A-Za-z][_0-9A-Za-z]*) on input type (?<typeName>[_A-Za-z][_0-9A-Za-z]*) was added\.$/,
    ),
    change,
  );
  const typeName = requireGroup(match, "typeName", change, "input field");
  const fieldName = requireGroup(match, "fieldName", change, "input field");
  return `${typeName}.${fieldName}`;
}

function deriveImplementedInterfaceCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(/^(?<typeName>[_A-Za-z][_0-9A-Za-z]*) /),
    change,
  );
  return requireGroup(match, "typeName", change, "interface implementation");
}

function deriveFieldArgumentAddedCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^An? (?:required|optional) arg (?<argName>[_A-Za-z][_0-9A-Za-z]*) on (?<typeName>[_A-Za-z][_0-9A-Za-z]*)\.(?<fieldName>[_A-Za-z][_0-9A-Za-z]*) was added\.$/,
    ),
    change,
  );
  const typeName = requireGroup(match, "typeName", change, "required arg");
  const fieldName = requireGroup(match, "fieldName", change, "required arg");
  const argName = requireGroup(match, "argName", change, "required arg");
  return `${typeName}.${fieldName}(${argName}:)`;
}

function deriveDirectiveCoordinate(change: GraphqlSchemaChange): string {
  const directiveRemovedMatch = change.description.match(
    /from (?<directiveName>[_A-Za-z][_0-9A-Za-z]*)\.$/,
  );
  const directiveName = directiveRemovedMatch?.groups?.["directiveName"];
  if (directiveName) {
    return `@${directiveName}`;
  }

  const simpleDirectiveMatch = mustMatch(
    change.description.match(/^(?<directiveName>[_A-Za-z][_0-9A-Za-z]*) was removed\.$/),
    change,
  );
  return `@${requireGroup(simpleDirectiveMatch, "directiveName", change, "directive")}`;
}

function deriveDirectiveArgumentRemovedCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^(?<argName>[_A-Za-z][_0-9A-Za-z]*) was removed from (?<directiveName>[_A-Za-z][_0-9A-Za-z]*)\.$/,
    ),
    change,
  );
  const directiveName = requireGroup(match, "directiveName", change, "directive arg");
  const argName = requireGroup(match, "argName", change, "directive arg");
  return `@${directiveName}(${argName}:)`;
}

function deriveRequiredDirectiveArgumentAddedCoordinate(change: GraphqlSchemaChange): string {
  const match = mustMatch(
    change.description.match(
      /^A required arg (?<argName>[_A-Za-z][_0-9A-Za-z]*) on directive (?<directiveName>[_A-Za-z][_0-9A-Za-z]*) was added\.$/,
    ),
    change,
  );
  const directiveName = requireGroup(match, "directiveName", change, "directive arg");
  const argName = requireGroup(match, "argName", change, "directive arg");
  return `@${directiveName}(${argName}:)`;
}

const coordinateDeriversByChangeType = {
  [BreakingChangeType.TYPE_REMOVED]: deriveTypeRemovedCoordinate,
  [BreakingChangeType.TYPE_CHANGED_KIND]: deriveTypeChangedKindCoordinate,
  [BreakingChangeType.TYPE_REMOVED_FROM_UNION]: deriveUnionCoordinate,
  [BreakingChangeType.VALUE_REMOVED_FROM_ENUM]: deriveEnumValueCoordinate,
  [BreakingChangeType.REQUIRED_INPUT_FIELD_ADDED]: deriveInputFieldCoordinate,
  [BreakingChangeType.IMPLEMENTED_INTERFACE_REMOVED]: deriveImplementedInterfaceCoordinate,
  [BreakingChangeType.FIELD_REMOVED]: toFieldCoordinateFromDescription,
  [BreakingChangeType.FIELD_CHANGED_KIND]: toFieldCoordinateFromDescription,
  [BreakingChangeType.REQUIRED_ARG_ADDED]: deriveFieldArgumentAddedCoordinate,
  [BreakingChangeType.ARG_REMOVED]: toFieldArgumentCoordinateFromDescription,
  [BreakingChangeType.ARG_CHANGED_KIND]: toFieldArgumentCoordinateFromDescription,
  [BreakingChangeType.DIRECTIVE_REMOVED]: deriveDirectiveCoordinate,
  [BreakingChangeType.DIRECTIVE_ARG_REMOVED]: deriveDirectiveArgumentRemovedCoordinate,
  [BreakingChangeType.REQUIRED_DIRECTIVE_ARG_ADDED]: deriveRequiredDirectiveArgumentAddedCoordinate,
  [BreakingChangeType.DIRECTIVE_REPEATABLE_REMOVED]: deriveDirectiveCoordinate,
  [BreakingChangeType.DIRECTIVE_LOCATION_REMOVED]: deriveDirectiveCoordinate,
  [DangerousChangeType.VALUE_ADDED_TO_ENUM]: deriveEnumValueCoordinate,
  [DangerousChangeType.TYPE_ADDED_TO_UNION]: deriveUnionCoordinate,
  [DangerousChangeType.OPTIONAL_INPUT_FIELD_ADDED]: deriveInputFieldCoordinate,
  [DangerousChangeType.OPTIONAL_ARG_ADDED]: deriveFieldArgumentAddedCoordinate,
  [DangerousChangeType.IMPLEMENTED_INTERFACE_ADDED]: deriveImplementedInterfaceCoordinate,
  [DangerousChangeType.ARG_DEFAULT_VALUE_CHANGE]: toFieldArgumentCoordinateFromDescription,
} as const satisfies Record<SupportedGraphqlSchemaChangeType, CoordinateDeriver>;

function assertCoordinateIsParsableAndResolvable({
  baselineSchema,
  candidateSchema,
  change,
  coordinate,
  resolutionMode,
}: {
  baselineSchema: GraphQLSchema | undefined;
  candidateSchema: GraphQLSchema;
  change: { description: string; type: string };
  coordinate: string;
  resolutionMode: CoordinateValidationMode;
}): void {
  try {
    parseSchemaCoordinate(coordinate);
  } catch (cause) {
    throw new SchemaCoordinateDerivationError({
      cause,
      changeDescription: change.description,
      changeType: change.type,
      coordinate,
      message: `Derived coordinate is invalid for ${change.type}: ${coordinate}`,
    });
  }

  const resolveInSchema = (schema: GraphQLSchema) => {
    try {
      return resolveSchemaCoordinate(schema, coordinate);
    } catch {
      return null;
    }
  };

  if (resolutionMode === "candidate_only") {
    const resolvedInCandidate = resolveInSchema(candidateSchema);
    if (resolvedInCandidate) {
      return;
    }

    throw new SchemaCoordinateDerivationError({
      changeDescription: change.description,
      changeType: change.type,
      coordinate,
      message: `Derived coordinate is not resolvable in candidate schema for ${change.type}: ${coordinate}`,
    });
  }

  const resolvedInBaseline = baselineSchema ? resolveInSchema(baselineSchema) : undefined;
  const resolvedInCandidate = resolveInSchema(candidateSchema);

  if (resolvedInBaseline || resolvedInCandidate) {
    return;
  }

  throw new SchemaCoordinateDerivationError({
    changeDescription: change.description,
    changeType: change.type,
    coordinate,
    message: `Derived coordinate is not resolvable in baseline or candidate schema for ${change.type}: ${coordinate}`,
  });
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
  compositionErrors,
}: {
  compositionErrors: ReadonlyArray<CompositionError>;
}): ValidateSubgraphSchemaAnalysis {
  return {
    composed: false,
    summary: {
      totalChanges: 0,
      breakingChanges: 0,
      dangerousChanges: 0,
      safeChanges: 0,
      compositionErrors: compositionErrors.length,
    },
    changes: [],
    compositionErrors: [...compositionErrors],
  };
}

function collectInputDefaultChanges(
  baselineSchema: GraphQLSchema,
  candidateSchema: GraphQLSchema,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const candidateType of Object.values(candidateSchema.getTypeMap())) {
    const baselineType = baselineSchema.getType(candidateType.name);
    if (!isInputObjectType(candidateType) || !isInputObjectType(baselineType)) continue;
    for (const field of Object.values(candidateType.getFields())) {
      const baselineField = baselineType.getFields()[field.name];
      if (!baselineField || isDeepStrictEqual(baselineField.defaultValue, field.defaultValue))
        continue;
      const coordinate = `${candidateType.name}.${field.name}`;
      const newlyRequired = !isRequiredInputField(baselineField) && isRequiredInputField(field);
      changes.push({
        coordinate,
        severity: newlyRequired ? "breaking" : "dangerous",
        type: "INPUT_FIELD_DEFAULT_VALUE_CHANGE",
        message: newlyRequired
          ? `${coordinate} became required after its default value was removed.`
          : `${coordinate} default value changed.`,
      });
    }
  }
  return changes;
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
    for (const change of safeChanges) {
      assertCoordinateIsParsableAndResolvable({
        baselineSchema: undefined,
        candidateSchema,
        change: {
          description: change.message,
          type: change.type,
        },
        coordinate: change.coordinate,
        resolutionMode: "candidate_only",
      });
    }

    return {
      composed: true,
      summary: {
        totalChanges: safeChanges.length,
        breakingChanges: 0,
        dangerousChanges: 0,
        safeChanges: safeChanges.length,
        compositionErrors: 0,
      },
      changes: safeChanges
        .map((change) => ({
          severity: "safe" as const,
          ...change,
        }))
        .toSorted(compareSchemaChanges),
      compositionErrors: [],
    };
  }

  const inputDefaultChanges = collectInputDefaultChanges(baselineSchema, candidateSchema);
  const breakingChanges = findBreakingChanges(baselineSchema, candidateSchema)
    .map((change) => {
      const coordinate = coordinateDeriversByChangeType[change.type](change);
      assertCoordinateIsParsableAndResolvable({
        baselineSchema,
        candidateSchema,
        change,
        resolutionMode: "baseline_or_candidate",
        coordinate,
      });
      return {
        coordinate,
        message: change.description,
        type: change.type,
      };
    })
    .toSorted(compareSchemaChangeBase);
  const dangerousChanges = findDangerousChanges(baselineSchema, candidateSchema)
    .map((change) => {
      const coordinate = coordinateDeriversByChangeType[change.type](change);
      assertCoordinateIsParsableAndResolvable({
        baselineSchema,
        candidateSchema,
        change,
        resolutionMode: "baseline_or_candidate",
        coordinate,
      });
      return {
        coordinate,
        message: change.description,
        type: change.type,
      };
    })
    .toSorted(compareSchemaChangeBase);
  const newlyRequiredArguments = new Set<string>();
  for (const candidateType of Object.values(candidateSchema.getTypeMap())) {
    const baselineType = baselineSchema.getType(candidateType.name);
    if (
      !(isObjectType(candidateType) || isInterfaceType(candidateType)) ||
      !(isObjectType(baselineType) || isInterfaceType(baselineType))
    )
      continue;
    for (const field of Object.values(candidateType.getFields())) {
      const baselineField = baselineType.getFields()[field.name];
      for (const argument of field.args) {
        const baselineArgument = baselineField?.args.find((value) => value.name === argument.name);
        if (
          baselineArgument &&
          !isRequiredArgument(baselineArgument) &&
          isRequiredArgument(argument)
        ) {
          newlyRequiredArguments.add(`${candidateType.name}.${field.name}(${argument.name}:)`);
        }
      }
    }
  }
  const promotedArgumentChanges = dangerousChanges.filter(
    (change) =>
      change.type === DangerousChangeType.ARG_DEFAULT_VALUE_CHANGE &&
      newlyRequiredArguments.has(change.coordinate),
  );
  const safeChanges = collectSafeAdditionChanges(baselineSchema, candidateSchema);
  for (const change of safeChanges) {
    assertCoordinateIsParsableAndResolvable({
      baselineSchema,
      candidateSchema,
      change: {
        description: change.message,
        type: change.type,
      },
      coordinate: change.coordinate,
      resolutionMode: "candidate_only",
    });
  }

  return {
    composed: true,
    summary: {
      totalChanges:
        breakingChanges.length +
        dangerousChanges.length +
        safeChanges.length +
        inputDefaultChanges.length,
      breakingChanges:
        breakingChanges.length +
        promotedArgumentChanges.length +
        inputDefaultChanges.filter((change) => change.severity === "breaking").length,
      dangerousChanges:
        dangerousChanges.length -
        promotedArgumentChanges.length +
        inputDefaultChanges.filter((change) => change.severity === "dangerous").length,
      safeChanges: safeChanges.length,
      compositionErrors: 0,
    },
    changes: [
      ...inputDefaultChanges,
      ...breakingChanges.map((change) => ({
        severity: "breaking" as const,
        ...change,
      })),
      ...dangerousChanges.map((change) => ({
        severity: promotedArgumentChanges.includes(change)
          ? ("breaking" as const)
          : ("dangerous" as const),
        ...change,
      })),
      ...safeChanges.map((change) => ({
        severity: "safe" as const,
        ...change,
      })),
    ].toSorted(compareSchemaChanges),
    compositionErrors: [],
  };
}
