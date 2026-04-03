import assert from "node:assert/strict";
import test from "node:test";

import { fastifyHandlerWithDependencies } from "./handler-with-dependencies.ts";

await test("fastifyHandlerWithDependencies preserves the handler this binding", async () => {
  const dependencies = { serviceName: "graphs" };
  const request = { id: "request-1" };
  const reply = { code: 200 };
  const server = { log: { info: () => null } };
  type TestRequest = typeof request;
  type TestReply = typeof reply;
  type TestServer = typeof server;
  type TestHandler = (this: TestServer, request: TestRequest, reply: TestReply) => Promise<string>;

  const wrappedHandler = fastifyHandlerWithDependencies<TestHandler>(
    async function handler(
      this: TestServer,
      {
        dependencies: handlerDependencies,
        reply: handlerReply,
        request: handlerRequest,
      }: {
        dependencies: typeof dependencies;
        reply: TestReply;
        request: TestRequest;
      },
    ) {
      assert.equal(handlerDependencies, dependencies);
      assert.equal(handlerRequest, request);
      assert.equal(handlerReply, reply);
      assert.equal(this, server);

      return "ok";
    },
    dependencies,
  );

  const result = await wrappedHandler.call(server, request, reply);
  assert.equal(result, "ok");
});
