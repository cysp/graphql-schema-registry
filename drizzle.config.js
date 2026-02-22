// oxlint-disable import/no-default-export, no-process-env

const databaseUrl = process.env["DATABASE_URL"];

if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to run drizzle-kit commands.");
}

export default {
  dbCredentials: {
    url: databaseUrl,
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/drizzle/schema.ts",
  strict: true,
  verbose: true,
};
