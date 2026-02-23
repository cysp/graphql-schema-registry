import { readFile } from "node:fs/promises";

export async function loadJwtVerificationPublicKeyFromFile(publicKeyPath: string): Promise<Buffer> {
  const publicKey = await readFile(publicKeyPath);
  if (publicKey.toString("utf8").trim().length === 0) {
    throw new Error(`Invalid JWT public key at "${publicKeyPath}": key file is empty.`);
  }

  return publicKey;
}
