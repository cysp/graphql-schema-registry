// oxlint-disable import/no-default-export

import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: {
    path: "./openapi/openapi.yaml",
  },
  output: "src/lib/openapi-ts",
  plugins: ["@hey-api/typescript", "zod", "fastify"],
});
