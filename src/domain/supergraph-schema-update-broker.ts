import { createAsyncNotificationGenerator } from "./routes/async-notification-generator.ts";
import {
  type SupergraphSchemaUpdatedNotification,
  decodeSupergraphSchemaUpdatedNotification,
  supergraphSchemaUpdatesChannel,
} from "./supergraph-schema-updates.ts";

type ListenMeta = {
  unlisten(): Promise<void>;
};

type ListenFunction = (channel: string, onnotify: (payload: string) => void) => Promise<ListenMeta>;

type BrokerLogger = {
  debug?: (attributes: Record<string, unknown>, message: string) => void;
  info?: (attributes: Record<string, unknown>, message: string) => void;
  warn?: (attributes: Record<string, unknown>, message: string) => void;
};

type NotificationFactory = () => Promise<
  AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>
>;

type SubscriberWaiter = {
  reject: (error: Error) => void;
  resolve: (result: IteratorResult<SupergraphSchemaUpdatedNotification, void>) => void;
};

type Subscriber = {
  cleanupPromise: Promise<void> | undefined;
  graphId: string;
  iterator: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>;
  pendingNotification: SupergraphSchemaUpdatedNotification | undefined;
  terminalError: Error | undefined;
  terminated: boolean;
  waiter: SubscriberWaiter | undefined;
};

type BrokerState = "closed" | "failed" | "idle" | "running" | "starting" | "stopping";

function resolveSubscriber(
  subscriber: Subscriber,
  result: IteratorResult<SupergraphSchemaUpdatedNotification, void>,
): void {
  if (!subscriber.waiter) {
    return;
  }

  const currentWaiter = subscriber.waiter;
  subscriber.waiter = undefined;
  currentWaiter.resolve(result);
}

function rejectSubscriber(subscriber: Subscriber, error: Error): void {
  if (!subscriber.waiter) {
    return;
  }

  const currentWaiter = subscriber.waiter;
  subscriber.waiter = undefined;
  currentWaiter.reject(error);
}

export class SupergraphSchemaUpdateBrokerFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SupergraphSchemaUpdateBrokerFailure";
  }
}

export type SupergraphSchemaUpdateBroker = {
  close(): Promise<void>;
  subscribe(
    graphId: string,
  ): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>>;
};

export function createSupergraphSchemaUpdateBroker(
  listen: ListenFunction,
  options: {
    createNotifications?: NotificationFactory;
    logger?: BrokerLogger;
  } = {},
): SupergraphSchemaUpdateBroker {
  const { logger } = options;
  const subscribersByGraph = new Map<string, Set<Subscriber>>();
  let failure: SupergraphSchemaUpdateBrokerFailure | undefined;
  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> | undefined;
  let notificationLoop: Promise<void> | undefined;
  let notificationStopRequested = false;
  let state: BrokerState = "idle";
  let subscriberCount = 0;
  let transition = Promise.resolve();
  let syncListenerState!: () => Promise<void>;

  const setState = (nextState: BrokerState): void => {
    if (state === nextState) {
      return;
    }

    logger?.debug?.(
      {
        activeSubscriberCount: subscriberCount,
        nextState,
        previousState: state,
      },
      "transitioned supergraph schema update broker state",
    );
    state = nextState;
  };

  const createNotifications =
    options.createNotifications ??
    (async (): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>> => {
      return createAsyncNotificationGenerator(listen, supergraphSchemaUpdatesChannel, (payload) => {
        const notification = decodeSupergraphSchemaUpdatedNotification(payload);
        if (!notification) {
          logger?.debug?.(
            { channel: supergraphSchemaUpdatesChannel },
            "ignored invalid supergraph schema update payload",
          );
        }

        return notification;
      });
    });

  const serializeTransition = async (fn: () => Promise<void>): Promise<void> => {
    const previousTransition = transition;
    let releaseTransition!: () => void;
    transition = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });

    try {
      await previousTransition;
      await fn();
    } finally {
      releaseTransition();
    }
  };

  const terminateSubscriber = (
    subscriber: Subscriber,
    termination:
      | {
          kind: "closed";
        }
      | {
          error: Error;
          kind: "failed";
        },
  ): void => {
    if (subscriber.terminated) {
      return;
    }

    subscriber.pendingNotification = undefined;
    subscriber.terminated = true;
    subscriber.terminalError = termination.kind === "failed" ? termination.error : undefined;

    if (termination.kind === "failed") {
      rejectSubscriber(subscriber, termination.error);
    } else {
      resolveSubscriber(subscriber, {
        done: true,
        value: undefined,
      });
    }

    const subscribers = subscribersByGraph.get(subscriber.graphId);
    if (subscribers) {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        subscribersByGraph.delete(subscriber.graphId);
      }
    }

    subscriberCount -= 1;
    logger?.debug?.(
      {
        activeSubscriberCount: subscriberCount,
        graphId: subscriber.graphId,
        terminationKind: termination.kind,
      },
      "removed supergraph schema update broker subscriber",
    );
  };

  const cleanupSubscriber = async (
    subscriber: Subscriber,
    {
      syncListenerStateAfterCleanup,
      termination,
    }: {
      syncListenerStateAfterCleanup: boolean;
      termination:
        | {
            kind: "closed";
          }
        | {
            error: Error;
            kind: "failed";
          };
    },
  ): Promise<void> => {
    if (subscriber.cleanupPromise) {
      return subscriber.cleanupPromise;
    }

    subscriber.cleanupPromise = (async () => {
      if (subscriber.terminated) {
        return;
      }

      terminateSubscriber(subscriber, termination);
      if (syncListenerStateAfterCleanup) {
        await serializeTransition(syncListenerState);
      }
    })();

    await subscriber.cleanupPromise;
  };

  const getActiveSubscribers = (): Subscriber[] => {
    return [...subscribersByGraph.values()].flatMap((subscribers) => [...subscribers]);
  };

  const closeActiveSubscribers = async (): Promise<void> => {
    const activeSubscribers = getActiveSubscribers();
    for (const subscriber of activeSubscribers) {
      await cleanupSubscriber(subscriber, {
        syncListenerStateAfterCleanup: false,
        termination: {
          kind: "closed",
        },
      });
    }
  };

  const failActiveSubscribers = async (
    error: SupergraphSchemaUpdateBrokerFailure,
  ): Promise<void> => {
    const activeSubscribers = getActiveSubscribers();
    for (const subscriber of activeSubscribers) {
      await cleanupSubscriber(subscriber, {
        syncListenerStateAfterCleanup: false,
        termination: {
          error,
          kind: "failed",
        },
      });
    }
  };

  const failBroker = async (error: unknown): Promise<void> => {
    if (failure || state === "closed") {
      return;
    }

    failure =
      error instanceof SupergraphSchemaUpdateBrokerFailure
        ? error
        : new SupergraphSchemaUpdateBrokerFailure(
            "Shared supergraph schema update listener terminated unexpectedly.",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
            },
          );
    setState("failed");
    logger?.warn?.(
      {
        activeSubscriberCount: subscriberCount,
        error: failure,
      },
      "shared supergraph schema update listener terminated unexpectedly",
    );
    await failActiveSubscribers(failure);
  };

  const dispatchNotification = (notification: SupergraphSchemaUpdatedNotification): void => {
    const subscribers = subscribersByGraph.get(notification.graphId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      if (subscriber.terminated) {
        continue;
      }

      if (subscriber.waiter) {
        resolveSubscriber(subscriber, {
          done: false,
          value: notification,
        });
        continue;
      }

      if (
        subscriber.pendingNotification &&
        notification.compositionRevision <= subscriber.pendingNotification.compositionRevision
      ) {
        logger?.debug?.(
          {
            graphId: subscriber.graphId,
            pendingRevision: String(subscriber.pendingNotification.compositionRevision),
            skippedRevision: String(notification.compositionRevision),
          },
          "ignored non-newer pending supergraph schema update notification",
        );
        continue;
      }

      if (subscriber.pendingNotification) {
        logger?.debug?.(
          {
            graphId: subscriber.graphId,
            nextPendingRevision: String(notification.compositionRevision),
            previousPendingRevision: String(subscriber.pendingNotification.compositionRevision),
          },
          "overwrote pending supergraph schema update notification",
        );
      }

      subscriber.pendingNotification = notification;
    }
  };

  syncListenerState = async (): Promise<void> => {
    if (state === "closed" || state === "failed" || subscriberCount === 0) {
      if (!notifications) {
        if (state !== "closed" && state !== "failed") {
          setState("idle");
        }
        return;
      }

      const currentNotifications = notifications;
      notifications = undefined;
      notificationStopRequested = true;
      setState("stopping");
      logger?.info?.(
        {
          activeSubscriberCount: subscriberCount,
        },
        "stopping shared supergraph schema update listener",
      );
      try {
        await currentNotifications.return();
        await notificationLoop;
      } finally {
        notificationStopRequested = false;
        notificationLoop = undefined;
      }

      if (state !== "closed" && state !== "failed") {
        setState("idle");
      }
      return;
    }

    if (notifications) {
      return;
    }

    setState("starting");
    logger?.info?.(
      {
        activeSubscriberCount: subscriberCount,
      },
      "starting shared supergraph schema update listener",
    );
    notifications = await createNotifications();
    setState("running");
    const currentNotifications = notifications;

    notificationLoop = (async () => {
      try {
        for await (const notification of currentNotifications) {
          dispatchNotification(notification);
        }
        if (!notificationStopRequested && subscriberCount > 0) {
          await failBroker(
            new SupergraphSchemaUpdateBrokerFailure(
              "Shared supergraph schema update listener ended unexpectedly.",
            ),
          );
        }
      } catch (error) {
        if (!notificationStopRequested && subscriberCount > 0) {
          await failBroker(error);
        }
      } finally {
        if (notifications === currentNotifications) {
          notifications = undefined;
        }

        notificationLoop = undefined;
        if (state === "running") {
          setState("idle");
        }
      }
    })();
  };

  const createSubscriber = (graphId: string): Subscriber => {
    let subscriber!: Subscriber;

    const iterator: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      async [Symbol.asyncDispose](): Promise<void> {
        await iterator.return();
      },
      async next(): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
        if (subscriber.pendingNotification) {
          const value = subscriber.pendingNotification;
          subscriber.pendingNotification = undefined;
          return {
            done: false,
            value,
          };
        }

        if (subscriber.terminalError) {
          throw subscriber.terminalError;
        }

        if (subscriber.terminated) {
          return {
            done: true,
            value: undefined,
          };
        }

        if (subscriber.waiter) {
          throw new Error("Concurrent next() calls are not supported for broker subscriptions.");
        }

        return new Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>>(
          (resolve, reject) => {
            subscriber.waiter = { reject, resolve };
          },
        );
      },
      async return(): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
        await cleanupSubscriber(subscriber, {
          syncListenerStateAfterCleanup: true,
          termination: {
            kind: "closed",
          },
        });
        return {
          done: true,
          value: undefined,
        };
      },
      async throw(
        error: unknown,
      ): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
        await cleanupSubscriber(subscriber, {
          syncListenerStateAfterCleanup: true,
          termination: {
            error: error instanceof Error ? error : new Error(String(error)),
            kind: "failed",
          },
        });
        throw error instanceof Error ? error : new Error(String(error));
      },
    };

    subscriber = {
      cleanupPromise: undefined,
      graphId,
      iterator,
      pendingNotification: undefined,
      terminalError: undefined,
      terminated: false,
      waiter: undefined,
    };

    return subscriber;
  };

  return {
    async close(): Promise<void> {
      if (state === "closed") {
        return;
      }

      setState("closed");
      logger?.info?.(
        {
          activeSubscriberCount: subscriberCount,
        },
        "closing supergraph schema update broker",
      );
      await closeActiveSubscribers();
      await serializeTransition(syncListenerState);
    },
    async subscribe(
      graphId: string,
    ): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>> {
      if (state === "closed") {
        throw new Error("Supergraph schema update broker is closed.");
      }

      const currentFailure = failure;
      if (currentFailure) {
        throw new SupergraphSchemaUpdateBrokerFailure(currentFailure.message, {
          cause: currentFailure,
        });
      }

      const subscriber = createSubscriber(graphId);

      const subscribers = subscribersByGraph.get(graphId);
      if (subscribers) {
        subscribers.add(subscriber);
      } else {
        subscribersByGraph.set(graphId, new Set([subscriber]));
      }

      subscriberCount += 1;
      logger?.debug?.(
        {
          activeSubscriberCount: subscriberCount,
          graphId,
        },
        "added supergraph schema update broker subscriber",
      );

      try {
        await serializeTransition(syncListenerState);
      } catch (error) {
        const graphSubscribers = subscribersByGraph.get(graphId);
        graphSubscribers?.delete(subscriber);
        if (graphSubscribers && graphSubscribers.size === 0) {
          subscribersByGraph.delete(graphId);
        }
        subscriberCount -= 1;
        logger?.debug?.(
          {
            activeSubscriberCount: subscriberCount,
            graphId,
          },
          "rolled back supergraph schema update broker subscriber after listen failure",
        );
        throw error;
      }

      return subscriber.iterator;
    },
  };
}
