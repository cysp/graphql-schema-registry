import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http";

import type { FastifyReply, FastifyRequest } from "fastify";

import { coerceProblemDetailsStatusCode, type ProblemDetailsStatusCode } from "./status-code.ts";

type ProblemDetailsErrorMetadata = {
  headers?: OutgoingHttpHeaders | undefined;
  logMessage: string;
  statusCode: ProblemDetailsStatusCode;
};

function isPropertyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOutgoingHttpHeader(value: unknown): value is OutgoingHttpHeader {
  return (
    typeof value === "number" ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((part) => typeof part === "string"))
  );
}

function isOutgoingHttpHeaders(value: unknown): value is OutgoingHttpHeaders {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.values(value).every(
    (headerValue) => headerValue === undefined || isOutgoingHttpHeader(headerValue),
  );
}

function getProblemDetailsErrorMetadata(
  error: unknown,
  currentStatusCode: number,
): ProblemDetailsErrorMetadata {
  const errorRecord = isPropertyBag(error) ? error : undefined;
  const fallbackStatusCode =
    currentStatusCode >= 400 ? (coerceProblemDetailsStatusCode(currentStatusCode) ?? 500) : 500;

  let statusCode = fallbackStatusCode;
  for (const candidate of [errorRecord?.["status"], errorRecord?.["statusCode"]]) {
    if (typeof candidate !== "number" || candidate < 400) {
      continue;
    }

    const coercedStatusCode = coerceProblemDetailsStatusCode(candidate);
    if (coercedStatusCode !== undefined) {
      statusCode = coercedStatusCode;
      break;
    }
  }

  const errorMessage = errorRecord?.["message"];
  const logMessage =
    error instanceof Error && error.message !== ""
      ? error.message
      : typeof errorMessage === "string" && errorMessage !== ""
        ? errorMessage
        : "Request failed";

  const headers = errorRecord?.["headers"];

  return {
    headers: isOutgoingHttpHeaders(headers) ? headers : undefined,
    logMessage,
    statusCode,
  };
}

export function problemDetailsErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const { headers, logMessage, statusCode } = getProblemDetailsErrorMetadata(
    error,
    reply.raw.statusCode,
  );

  reply.code(statusCode);

  if (statusCode < 500) {
    reply.log.info({ res: reply, err: error }, logMessage);
  } else {
    reply.log.error({ req: request, res: reply, err: error }, logMessage);
  }

  reply.problemDetails({
    status: statusCode,
    headers,
  });
}
