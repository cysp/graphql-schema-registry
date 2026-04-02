import type { operationRouteDefinitions } from "./generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "./plugin.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type Assert<T extends true> = T;

type IsUnknown<T> = unknown extends T ? ([keyof T] extends [never] ? true : false) : false;

type ListGraphsReply = Parameters<OperationHandlers["listGraphs"]>[1];
type ListGraphsSendPayload = Parameters<ListGraphsReply["send"]>[0];

export type ListGraphsReplyPayloadIsTyped = Assert<
  IsUnknown<ListGraphsSendPayload> extends false ? true : false
>;
