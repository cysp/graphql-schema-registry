type RequestReplyHandler = (...args: readonly [never, never]) => unknown;

export type DependencyInjectedHandlerContext<
  THandler extends RequestReplyHandler,
  TRouteDependencies extends object,
> = {
  dependencies: TRouteDependencies;
  reply: Parameters<THandler>[1];
  request: Parameters<THandler>[0];
};

type DependencyInjectedHandler<
  THandler extends RequestReplyHandler,
  TRouteDependencies extends object,
> = (
  args: DependencyInjectedHandlerContext<THandler, TRouteDependencies>,
) => ReturnType<THandler>;

export function fastifyHandlerWithDependencies<
  THandler extends RequestReplyHandler,
  TRouteDependencies extends object,
>(
  handler: DependencyInjectedHandler<THandler, TRouteDependencies>,
  dependencies: TRouteDependencies,
): (...args: Parameters<THandler>) => ReturnType<THandler> {
  return (request, reply) => handler({ dependencies, reply, request });
}
