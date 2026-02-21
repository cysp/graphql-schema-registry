import type { Probe, CheckStatus } from "./types.ts";

export async function executeProbe(probe: Probe): Promise<CheckStatus> {
  try {
    const status = await probe();
    return status || "ok";
  } catch {
    return "error";
  }
}

export async function executeProbes(
  probes: Record<string, Probe>,
): Promise<Record<keyof typeof probes, CheckStatus>> {
  const results: Record<keyof typeof probes, CheckStatus> = {};
  for (const [probeName, probe] of Object.entries(probes)) {
    results[probeName] = await executeProbe(probe);
  }
  return results;
}
