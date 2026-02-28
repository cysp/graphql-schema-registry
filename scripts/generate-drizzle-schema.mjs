// oxlint-disable eslint-plugin-node/no-process-env

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const outputPath = resolve(repositoryRoot, "db/schema.sql");
const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/postgres";
const deferrableConstraintNames = ["graphs_current_revision_fk", "subgraphs_current_revision_fk"];

const exportedSchema = execFileSync(
  "pnpm",
  ["exec", "drizzle-kit", "export", "--config=drizzle.config.js"],
  {
    cwd: repositoryRoot,
    env: Object.assign({}, process.env, { DATABASE_URL: databaseUrl }),
    encoding: "utf8",
  },
);

const normalizedSchema = exportedSchema
  .split("\n")
  .map((line) => {
    const isDeferrableConstraint = deferrableConstraintNames.some((constraintName) =>
      line.includes(`ADD CONSTRAINT "${constraintName}"`),
    );

    if (!isDeferrableConstraint) {
      return line;
    }

    const lineWithoutDeferrable = line.replace(/\s+DEFERRABLE INITIALLY DEFERRED;$/, ";");
    return lineWithoutDeferrable.endsWith(";")
      ? lineWithoutDeferrable.replace(/;$/, " DEFERRABLE INITIALLY DEFERRED;")
      : `${lineWithoutDeferrable} DEFERRABLE INITIALLY DEFERRED`;
  })
  .join("\n");

for (const constraintName of deferrableConstraintNames) {
  const deferredConstraint = `ADD CONSTRAINT "${constraintName}"`;
  if (!normalizedSchema.includes(deferredConstraint)) {
    throw new Error(`Expected to find constraint ${constraintName} in generated schema.`);
  }

  const deferrableLinePattern = new RegExp(
    `^ALTER TABLE .*${deferredConstraint}.*DEFERRABLE INITIALLY DEFERRED;$`,
    "m",
  );
  if (!deferrableLinePattern.test(normalizedSchema)) {
    throw new Error(`Expected constraint ${constraintName} to be deferrable in generated schema.`);
  }
}

writeFileSync(outputPath, normalizedSchema);
