// oxlint-disable import/no-default-export

import { fastifyRoutesPlugin } from "./src/lib/openapi-ts-plugins/fastify-routes/plugin.ts";

export default {
  input: {
    path: "./openapi/openapi.yaml",
  },
  output: {
    clean: true,
    path: "src/lib/openapi-ts",
  },
  plugins: ["@hey-api/typescript", "zod", "fastify", fastifyRoutesPlugin],
};
