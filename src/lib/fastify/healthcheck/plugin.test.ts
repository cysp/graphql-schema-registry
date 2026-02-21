import assert from "node:assert/strict";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { healthcheckPlugin } from "./plugin.ts";
import type { HealthcheckResponse } from "./types.ts";

await test("healthcheck plugin", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("returns ok for empty probe set", async () => {
    server.register(healthcheckPlugin, {
      probes: {},
    });

    const response = await server.inject({ method: "GET", url: "/health" });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(payload, {
      status: "ok",
      checks: {},
    });
  });

  await t.test("normalizes empty probe results to ok", async () => {
    let pingChecks = 0;
    let databaseChecks = 0;

    server.register(healthcheckPlugin, {
      probes: {
        ping: () => {
          pingChecks += 1;
        },
        database: async () => {
          databaseChecks += 1;
          await Promise.resolve();
          return "ok";
        },
      },
    });

    const response = await server.inject({ method: "GET", url: "/health" });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(pingChecks, 1);
    assert.strictEqual(databaseChecks, 1);
    assert.deepStrictEqual(payload, {
      status: "ok",
      checks: {
        ping: "ok",
        database: "ok",
      },
    });
  });

  await t.test("returns warn when any probe is warn and none are error", async () => {
    server.register(healthcheckPlugin, {
      probes: {
        database: async () => {
          await Promise.resolve();
          return "ok";
        },
        queue: async () => {
          await Promise.resolve();
          return "warn";
        },
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(payload, {
      status: "warn",
      checks: {
        database: "ok",
        queue: "warn",
      },
    });
  });

  await t.test("treats explicit error probe results as fatal", async () => {
    server.register(healthcheckPlugin, {
      probes: {
        database: async () => {
          await Promise.resolve();
          return "ok";
        },
        cache: async () => {
          await Promise.resolve();
          return "error";
        },
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 503);
    assert.deepStrictEqual(payload, {
      status: "error",
      checks: {
        database: "ok",
        cache: "error",
      },
    });
  });

  await t.test("returns error when warn probe appears before error probe", async () => {
    server.register(healthcheckPlugin, {
      probes: {
        queue: async () => {
          await Promise.resolve();
          return "warn";
        },
        cache: async () => {
          await Promise.resolve();
          return "error";
        },
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 503);
    assert.deepStrictEqual(payload, {
      status: "error",
      checks: {
        queue: "warn",
        cache: "error",
      },
    });
  });

  await t.test("maps thrown probes to error and returns 503", async () => {
    let failedChecks = 0;
    let queueChecks = 0;

    server.register(healthcheckPlugin, {
      probes: {
        database: async () => {
          await Promise.resolve();
          return "ok";
        },
        cache: () => {
          failedChecks += 1;
          throw new Error("cache unreachable");
        },
        queue: async () => {
          queueChecks += 1;
          await Promise.resolve();
          return "warn";
        },
      },
    });

    const response = await server.inject({ method: "GET", url: "/health" });
    const payload = response.json<HealthcheckResponse>();

    assert.strictEqual(response.statusCode, 503);
    assert.strictEqual(failedChecks, 1);
    assert.strictEqual(queueChecks, 1);
    assert.deepStrictEqual(payload, {
      status: "error",
      checks: {
        database: "ok",
        cache: "error",
        queue: "warn",
      },
    });
  });
});
