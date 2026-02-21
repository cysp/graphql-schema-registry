import { z } from "zod";

export const checkStatusSchema = z.enum(["ok", "warn", "error"]);
export const responseSchema = z.object({
  status: checkStatusSchema,
  checks: z.record(z.string(), checkStatusSchema),
});
