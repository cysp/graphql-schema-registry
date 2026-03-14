import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedFile } from "./types.ts";

export async function writeGeneratedFiles(
  outputDirectory: string,
  generatedFiles: readonly GeneratedFile[],
): Promise<void> {
  const normalizedOutputDirectory = path.resolve(outputDirectory);
  await rm(normalizedOutputDirectory, {
    force: true,
    recursive: true,
  });
  await mkdir(normalizedOutputDirectory, {
    recursive: true,
  });

  for (const generatedFile of generatedFiles.toSorted((left, right) => {
    return left.relativePath.localeCompare(right.relativePath);
  })) {
    const absoluteFilePath = path.join(normalizedOutputDirectory, generatedFile.relativePath);
    await mkdir(path.dirname(absoluteFilePath), {
      recursive: true,
    });
    await writeFile(absoluteFilePath, generatedFile.content, "utf8");
  }
}
