export const fastifyPluginTypesTemplate = [
  "type OperationId = keyof RouteHandlers;",
  "",
  "export type RouteHandlersByOperationId = {",
  "  [TOperationId in OperationId]: RouteHandlers[TOperationId];",
  "};",
  "",
  "export type FastifyRouteHandlersPluginOptions = {",
  "  handlers: RouteHandlersByOperationId;",
  "};",
].join("\n");
