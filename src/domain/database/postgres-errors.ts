import postgres from "postgres";

const uniqueViolationErrorCode = "23505";

function findPostgresError(error: unknown): postgres.PostgresError | undefined {
  if (error instanceof postgres.PostgresError) {
    return error;
  }

  if (error instanceof Error && "cause" in error) {
    return findPostgresError(error.cause);
  }

  return undefined;
}

export function isUniqueViolation(error: unknown): error is postgres.PostgresError {
  return findPostgresError(error)?.code === uniqueViolationErrorCode;
}
