export function createProcessSignalAbortController(): AbortController {
  const abortController = new AbortController();

  process.once("SIGINT", () => {
    abortController.abort("SIGINT");
  });

  process.once("SIGTERM", () => {
    abortController.abort("SIGTERM");
  });

  return abortController;
}
