import type { CheckStatus } from "./types.ts";

export function maximumCheckStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  if (a === "error" || b === "error") {
    return "error";
  }
  if (a === "warn" || b === "warn") {
    return "warn";
  }
  return "ok";
}

export function determineOverallStatus(checkStatuses: Record<string, CheckStatus>): CheckStatus {
  let status: CheckStatus = "ok";

  for (const checkStatus of Object.values(checkStatuses)) {
    status = maximumCheckStatus(status, checkStatus);
  }

  return status;
}
