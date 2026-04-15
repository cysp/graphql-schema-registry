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
  resolve: (result: IteratorResult<SupergraphSchemaUpdatedNotification, void>) => void;
};

type Subscriber = {
  cleanupPromise: Promise<void> | undefined;
  closed: boolean;
  graphId: string;
  iterator: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>;
  pendingNotification: SupergraphSchemaUpdatedNotification | undefined;
  waiter: SubscriberWaiter | undefined;
};

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
  let closed = false;
  let failure: Error | undefined;
  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> | undefined;
  let notificationLoop: Promise<void> | undefined;
  let notificationStopRequested = false;
  let subscriberCount = 0;
  let transition = Promise.resolve();
  let syncListenerState!: () => Promise<void>;

  const createNotifications =
    options.createNotifications ??
    (async (): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>> => {
      return createAsyncNotificationGenerator(
        listen,
        supergraphSchemaUpdatesChannel,
        (payload) => {
          const notification = decodeSupergraphSchemaUpdatedNotification(payload);
          if (!notification) {
            logger?.debug?.(
              { channel: supergraphSchemaUpdatesChannel },
              "ignored invalid supergraph schema update payload",
            );
          }

          return notification;
        },
      );
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

  const removeSubscriber = (subscriber: Subscriber): void => {
    if (subscriber.closed) {
      return;
    }

    subscriber.closed = true;
    subscriber.pendingNotification = undefined;
    resolveSubscriber(subscriber, {
      done: true,
      value: undefined,
    });

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
      },
      "removed supergraph schema update broker subscriber",
    );
  };

  const cleanupSubscriber = async (
    subscriber: Subscriber,
    {
      syncListenerStateAfterCleanup,
    }: {
      syncListenerStateAfterCleanup: boolean;
    },
  ): Promise<void> => {
    if (subscriber.cleanupPromise) {
      return subscriber.cleanupPromise;
    }

    subscriber.cleanupPromise = (async () => {
      if (subscriber.closed) {
        return;
      }

      removeSubscriber(subscriber);
      if (syncListenerStateAfterCleanup) {
        await serializeTransition(syncListenerState);
      }
    })();

    await subscriber.cleanupPromise;
  };

  const getActiveSubscribers = (): Subscriber[] => {
    return [...subscribersByGraph.values()].flatMap((subscribers) => [...subscribers]);
  };

  const failActiveSubscribers = async (): Promise<void> => {
    const activeSubscribers = getActiveSubscribers();
    await Promise.all(
      activeSubscribers.map(async (subscriber) => {
        await cleanupSubscriber(subscriber, {
          syncListenerStateAfterCleanup: false,
        });
      }),
    );
  };

  const failBroker = async (error: unknown): Promise<void> => {
    if (failure || closed) {
      return;
    }

    failure = error instanceof Error ? error : new Error(String(error));
    logger?.warn?.(
      {
        activeSubscriberCount: subscriberCount,
        error: failure,
      },
      "shared supergraph schema update listener terminated unexpectedly",
    );
    await failActiveSubscribers();
  };

  const dispatchNotification = (notification: SupergraphSchemaUpdatedNotification): void => {
    const subscribers = subscribersByGraph.get(notification.graphId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      if (subscriber.closed) {
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
    if (closed || failure || subscriberCount === 0) {
      if (!notifications) {
        return;
      }

      const currentNotifications = notifications;
      notifications = undefined;
      notificationStopRequested = true;
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
      return;
    }

    if (notifications) {
      return;
    }

    logger?.info?.(
      {
        activeSubscriberCount: subscriberCount,
      },
      "starting shared supergraph schema update listener",
    );
    notifications = await createNotifications();
    const currentNotifications = notifications;

    notificationLoop = (async () => {
      try {
        for await (const notification of currentNotifications) {
          dispatchNotification(notification);
        }
        if (!notificationStopRequested && subscriberCount > 0) {
          await failBroker(new Error("Shared supergraph schema update listener ended unexpectedly."));
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

        if (subscriber.closed) {
          return {
            done: true,
            value: undefined,
          };
        }

        if (subscriber.waiter) {
          throw new Error("Concurrent next() calls are not supported for broker subscriptions.");
        }

        return new Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>>((resolve) => {
          subscriber.waiter = { resolve };
        });
      },
      async return(): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
        await cleanupSubscriber(subscriber, {
          syncListenerStateAfterCleanup: true,
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
        });
        throw error instanceof Error ? error : new Error(String(error));
      },
    };

    subscriber = {
      cleanupPromise: undefined,
      closed: false,
      graphId,
      iterator,
      pendingNotification: undefined,
      waiter: undefined,
    };

    return subscriber;
  };

  return {
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      logger?.info?.(
        {
          activeSubscriberCount: subscriberCount,
        },
        "closing supergraph schema update broker",
      );
      await failActiveSubscribers();
      await serializeTransition(syncListenerState);
    },
    async subscribe(
      graphId: string,
    ): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>> {
      if (closed) {
        throw new Error("Supergraph schema update broker is closed.");
      }

      if (failure) {
        throw new Error("Supergraph schema update broker listener failed.", {
          cause: failure,
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
