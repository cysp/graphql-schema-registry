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
): SupergraphSchemaUpdateBroker {
  const subscribersByGraph = new Map<string, Set<Subscriber>>();
  let closed = false;
  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> | undefined;
  let notificationLoop: Promise<void> | undefined;
  let subscriberCount = 0;
  let transition = Promise.resolve();

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

      subscriber.pendingNotification = notification;
    }
  };

  const syncListenerState = async (): Promise<void> => {
    if (closed || subscriberCount === 0) {
      if (!notifications) {
        return;
      }

      const currentNotifications = notifications;
      notifications = undefined;
      await currentNotifications.return();
      await notificationLoop;
      notificationLoop = undefined;
      return;
    }

    if (notifications) {
      return;
    }

    notifications = await createAsyncNotificationGenerator(
      listen,
      supergraphSchemaUpdatesChannel,
      decodeSupergraphSchemaUpdatedNotification,
    );
    const currentNotifications = notifications;

    notificationLoop = (async () => {
      try {
        for await (const notification of currentNotifications) {
          dispatchNotification(notification);
        }
      } finally {
        if (notifications === currentNotifications) {
          notifications = undefined;
        }

        notificationLoop = undefined;
      }
    })();
  };

  const cleanupSubscriber = async (subscriber: Subscriber): Promise<void> => {
    if (subscriber.cleanupPromise) {
      return subscriber.cleanupPromise;
    }

    subscriber.cleanupPromise = (async () => {
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
      await serializeTransition(syncListenerState);
    })();

    await subscriber.cleanupPromise;
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
        await cleanupSubscriber(subscriber);
        return {
          done: true,
          value: undefined,
        };
      },
      async throw(
        error: unknown,
      ): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
        await cleanupSubscriber(subscriber);
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
      const activeSubscribers = [...subscribersByGraph.values()].flatMap((subscribers) => [
        ...subscribers,
      ]);
      await Promise.all(
        activeSubscribers.map(async (subscriber) => {
          await cleanupSubscriber(subscriber);
        }),
      );
      await serializeTransition(syncListenerState);
    },
    async subscribe(
      graphId: string,
    ): Promise<AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>> {
      if (closed) {
        throw new Error("Supergraph schema update broker is closed.");
      }

      const subscriber = createSubscriber(graphId);

      const subscribers = subscribersByGraph.get(graphId);
      if (subscribers) {
        subscribers.add(subscriber);
      } else {
        subscribersByGraph.set(graphId, new Set([subscriber]));
      }

      subscriberCount += 1;

      try {
        await serializeTransition(syncListenerState);
      } catch (error) {
        const graphSubscribers = subscribersByGraph.get(graphId);
        graphSubscribers?.delete(subscriber);
        if (graphSubscribers && graphSubscribers.size === 0) {
          subscribersByGraph.delete(graphId);
        }
        subscriberCount -= 1;
        throw error;
      }

      return subscriber.iterator;
    },
  };
}
