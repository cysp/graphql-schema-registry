import type { z } from "zod";

import type { responseSchema, checkStatusSchema } from "./schemas.ts";

export type Probe =
  | (() => Promise<void>)
  | (() => void)
  | (() => Promise<CheckStatus>)
  | (() => CheckStatus);

export type HealthcheckResponse = z.infer<typeof responseSchema>;

export type CheckStatus = z.infer<typeof checkStatusSchema>;
