import assert from "node:assert/strict";
import { verify } from "node:crypto";
import test from "node:test";

import { createAuthJwtSigner } from "./jwt-signer.ts";

function decodeBase64urlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function assertObjectRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.strictEqual(typeof value, "object");
  assert.ok(value);
  assert.strictEqual(Array.isArray(value), false);
}

function parseJwt(token: string): {
  encodedPayload: string;
  encodedProtectedHeader: string;
  signature: string;
} {
  const [encodedProtectedHeader, encodedPayload, signature] = token.split(".");
  assert.ok(encodedProtectedHeader);
  assert.ok(encodedPayload);
  assert.ok(signature);

  return {
    encodedPayload,
    encodedProtectedHeader,
    signature,
  };
}

await test("createAuthJwtSigner", async (t) => {
  await t.test("creates signed RS256 tokens with default auth claims", () => {
    const signer = createAuthJwtSigner();
    const token = signer.createToken();

    const { encodedPayload, encodedProtectedHeader, signature } = parseJwt(token);

    const protectedHeader = decodeBase64urlJson(encodedProtectedHeader);
    assert.deepStrictEqual(protectedHeader, {
      alg: "RS256",
      typ: "JWT",
    });

    const claims = decodeBase64urlJson(encodedPayload);
    assertObjectRecord(claims);
    assert.strictEqual(claims["aud"], "graphql-schema-registry");
    assert.strictEqual(claims["iss"], "https://auth.example.com");
    assert.deepStrictEqual(claims["authorization_details"], []);
    assert.strictEqual(typeof claims["exp"], "number");
    assert.strictEqual(typeof claims["iat"], "number");
    assert.strictEqual(typeof claims["nbf"], "number");

    const signedPayload = `${encodedProtectedHeader}.${encodedPayload}`;
    const signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(signedPayload, "utf8"),
      signer.jwtVerification.verificationPublicKey,
      Buffer.from(signature, "base64url"),
    );
    assert.strictEqual(signatureValid, true);
  });

  await t.test("supports custom audience, issuer, and claim overrides", () => {
    const signer = createAuthJwtSigner({
      audience: "custom-aud",
      issuer: "https://issuer.example.com",
    });
    const token = signer.createToken({
      authorization_details: [{ scope: "admin", type: "graphql-schema-registry" }],
      sub: "user-123",
    });

    assert.strictEqual(signer.jwtVerification.audience, "custom-aud");
    assert.strictEqual(signer.jwtVerification.issuer, "https://issuer.example.com");

    const { encodedPayload, encodedProtectedHeader, signature } = parseJwt(token);
    const claims = decodeBase64urlJson(encodedPayload);
    assertObjectRecord(claims);
    assert.strictEqual(claims["aud"], "custom-aud");
    assert.strictEqual(claims["iss"], "https://issuer.example.com");
    assert.strictEqual(claims["sub"], "user-123");
    assert.deepStrictEqual(claims["authorization_details"], [
      { scope: "admin", type: "graphql-schema-registry" },
    ]);

    const signedPayload = `${encodedProtectedHeader}.${encodedPayload}`;
    const signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(signedPayload, "utf8"),
      signer.jwtVerification.verificationPublicKey,
      Buffer.from(signature, "base64url"),
    );
    assert.strictEqual(signatureValid, true);
  });
});
