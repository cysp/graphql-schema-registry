type ListenMeta = {
  unlisten(): Promise<void>;
};

type ListenFunction = (channel: string, onnotify: (payload: string) => void) => Promise<ListenMeta>;

type IteratorWaiter<T> = {
  resolve: (result: IteratorResult<T, void>) => void;
};

export async function createAsyncNotificationGenerator<T>(
  listen: ListenFunction,
  channel: string,
  decode: (payload: string) => T | undefined,
): Promise<AsyncGenerator<T, void, void>> {
  const queue: T[] = [];
  let closed = false;
  let waiter: IteratorWaiter<T> | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const resolveNext = (result: IteratorResult<T, void>): void => {
    if (!waiter) {
      return;
    }

    const currentWaiter = waiter;
    waiter = undefined;
    currentWaiter.resolve(result);
  };

  const listenMeta = await listen(channel, (payload) => {
    if (closed) {
      return;
    }

    const value = decode(payload);
    if (value === undefined) {
      return;
    }

    if (waiter) {
      resolveNext({ done: false, value });
      return;
    }

    queue.push(value);
  });

  const cleanup = async (): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    closed = true;
    resolveNext({ done: true, value: undefined });
    cleanupPromise = listenMeta.unlisten();
    return cleanupPromise;
  };

  const iterator: AsyncGenerator<T, void, void> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await iterator.return();
    },
    async next(): Promise<IteratorResult<T, void>> {
      if (queue.length > 0) {
        const value = queue.shift();
        if (value === undefined) {
          throw new Error("Notification queue unexpectedly returned no value.");
        }

        return { done: false, value };
      }

      if (closed) {
        return { done: true, value: undefined };
      }

      return new Promise<IteratorResult<T, void>>((resolve) => {
        waiter = { resolve };
      });
    },
    async return(): Promise<IteratorResult<T, void>> {
      await cleanup();
      return { done: true, value: undefined };
    },
    async throw(error: unknown): Promise<IteratorResult<T, void>> {
      await cleanup();
      throw error instanceof Error ? error : new Error(String(error));
    },
  };

  return iterator;
}
