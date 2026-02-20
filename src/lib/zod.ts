import { z } from "zod";

export const optionalNonBlankString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  if (value.trim() === "") {
    return;
  }

  return value;
}, z.optional(z.string()));
