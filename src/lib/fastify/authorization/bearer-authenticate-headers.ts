import type { OutgoingHttpHeaders } from "node:http";

export const bearerAuthenticateHeaders = {
  "www-authenticate": "Bearer",
} satisfies OutgoingHttpHeaders;
