import type { FromSchema } from "json-schema-to-ts";

import type { checkStatusJsonSchema, responseJsonSchema } from "./schemas.ts";

export type Probe =
  | (() => Promise<void>)
  | (() => void)
  | (() => Promise<CheckStatus>)
  | (() => CheckStatus);

export type HealthcheckResponse = FromSchema<typeof responseJsonSchema>;

export type CheckStatus = FromSchema<typeof checkStatusJsonSchema>;
