// oxlint-disable eslint-plugin-promise/prefer-await-to-callbacks,typescript-eslint/no-unsafe-assignment,typescript-eslint/no-unsafe-call,typescript-eslint/no-unsafe-member-access,typescript-eslint/no-unsafe-return,typescript-eslint/no-unsafe-type-assertion

import type { PostgresJsDatabase, PostgresJsTransaction } from "../drizzle/types.ts";

export type FailureConfig = {
  error: Error;
  kind: "insert" | "update";
  table: object;
};

function createFailingTransaction(
  transaction: PostgresJsTransaction,
  failure: FailureConfig,
): PostgresJsTransaction {
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === "insert" && failure.kind === "insert") {
        return (table: unknown) => {
          if (table === failure.table) {
            return {
              values: () => {
                throw failure.error;
              },
            };
          }

          return target.insert(table as Parameters<PostgresJsTransaction["insert"]>[0]);
        };
      }

      if (property === "update" && failure.kind === "update") {
        return (table: unknown) => {
          if (table === failure.table) {
            return {
              set: () => {
                throw failure.error;
              },
            };
          }

          return target.update(table as Parameters<PostgresJsTransaction["update"]>[0]);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createFailingDatabase(
  database: PostgresJsDatabase,
  failure: FailureConfig,
): PostgresJsDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return async (callback: (transaction: PostgresJsTransaction) => Promise<unknown>) =>
          target.transaction(async (transaction) =>
            callback(createFailingTransaction(transaction, failure)),
          );
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
