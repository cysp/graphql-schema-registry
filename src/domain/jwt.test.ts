import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadJwtVerificationPublicKeyFromFile } from "./jwt.ts";

await test("loadJwtVerificationPublicKeyFromFile", async (t) => {
  await t.test("loads a valid PEM public key file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "graphql-schema-registry-public-key-"));
    const publicKeyPath = join(tempDirectory, "public-key.pem");

    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const exportedPublicKey = publicKey.export({ format: "pem", type: "spki" });
    const publicKeyPem =
      typeof exportedPublicKey === "string"
        ? Buffer.from(exportedPublicKey, "utf8")
        : exportedPublicKey;

    await writeFile(publicKeyPath, publicKeyPem);

    const loadedPublicKey = await loadJwtVerificationPublicKeyFromFile(publicKeyPath);

    assert.deepStrictEqual(loadedPublicKey, publicKeyPem);
  });

  await t.test("throws when the key file is empty", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "graphql-schema-registry-public-key-"));
    const publicKeyPath = join(tempDirectory, "public-key.pem");

    await writeFile(publicKeyPath, " \n ", "utf8");

    await assert.rejects(async () => {
      await loadJwtVerificationPublicKeyFromFile(publicKeyPath);
    }, /Invalid JWT public key/);
  });
});
