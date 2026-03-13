import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import { sql } from "drizzle-orm";
import fastify, { type FastifyInstance } from "fastify";

import { formatUser } from "./domain/authorization/user.ts";
import type { JwtVerification } from "./domain/jwt.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";

type CreateFastifyServerOptions = {
  database?: Pick<PostgresJsDatabase, "execute"> | undefined;
  jwtVerification?: JwtVerification | undefined;
};

export function createFastifyServer({
  database,
  jwtVerification,
}: CreateFastifyServerOptions): FastifyInstance {
  const server = fastify({
    logger: true,
  });

  server.register(fastifySensible);

  server.register(healthcheckPlugin, {
    probes: {
      database: async () => {
        if (!database) {
          return "warn";
        }

        await database.execute(sql`SELECT 1`);
        return "ok";
      },
    },
  });

  server.register(async function (server) {
    if (jwtVerification) {
      const verifyOptions: NonNullable<FastifyJWTOptions["verify"]> = {
        algorithms: ["RS256"],
        allowedAud: jwtVerification.audience,
        allowedIss: jwtVerification.issuer,
      };

      server.register(fastifyJwt, {
        formatUser,
        secret: {
          public: jwtVerification.verificationPublicKey,
        },
        verify: verifyOptions,
      });

      server.addHook("onRequest", async (request, reply) => {
        const authorizationHeader = request.headers.authorization;
        if (typeof authorizationHeader !== "string" || authorizationHeader.trim() === "") {
          return reply.unauthorized();
        }

        try {
          await request.jwtVerify();
        } catch (error) {
          request.log.warn({ error }, "failed to validate bearer token claims");
          return reply.unauthorized();
        }
      });
    }

    server.get("/", async (_, reply) => {
      return reply.code(204).send();
    });

    server.get("/user/grants", async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized();
      }

      return reply.code(200).send(request.user.grants);
    });
  });

  return server;
}
