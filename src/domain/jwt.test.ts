import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createJwtSigningKeyPair } from "./jwt.fixture.ts";
import { loadJwtVerificationPublicKeyFromFile } from "./jwt.ts";

await test("loadJwtVerificationPublicKeyFromFile", async (t) => {
  await t.test("loads a valid PEM public key file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "graphql-schema-registry-public-key-"));
    const publicKeyPath = join(tempDirectory, "public-key.pem");

    const { verificationPublicKey } = createJwtSigningKeyPair();

    await writeFile(publicKeyPath, verificationPublicKey);

    const loadedPublicKey = await loadJwtVerificationPublicKeyFromFile(publicKeyPath);

    assert.deepStrictEqual(loadedPublicKey, verificationPublicKey);
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
