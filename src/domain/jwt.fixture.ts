import { generateKeyPairSync, sign } from "node:crypto";

import type { JwtVerification } from "./jwt.ts";

export type JwtClaims = Record<string, unknown>;

type JwtHeader = Record<string, unknown>;

export type JwtFixture = {
  createToken: (claimsOverrides?: JwtClaims) => string;
  jwtVerification: JwtVerification;
};

export type JwtSigningKeyPair = {
  privateKey: string | Buffer;
  verificationPublicKey: Buffer;
};

function encodeBase64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createJwtSigningKeyPair(): JwtSigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const exportedPublicKey = publicKey.export({ format: "pem", type: "spki" });
  const verificationPublicKey =
    typeof exportedPublicKey === "string"
      ? Buffer.from(exportedPublicKey, "utf8")
      : exportedPublicKey;

  return {
    privateKey: privateKeyPem,
    verificationPublicKey,
  };
}

export function createDefaultJwtClaims({
  audience,
  issuer,
  now = Date.now(),
}: {
  audience: string;
  issuer: string;
  now?: number;
}): JwtClaims {
  const nowSeconds = Math.floor(now / 1000);

  return {
    aud: audience,
    authorization_details: [],
    exp: nowSeconds + 300,
    iat: nowSeconds - 10,
    iss: issuer,
    nbf: nowSeconds - 10,
  };
}

export function createSignedJwt({
  claims,
  header = {
    alg: "RS256",
    typ: "JWT",
  },
  privateKey,
}: {
  claims: JwtClaims;
  header?: JwtHeader;
  privateKey: string | Buffer;
}): string {
  const encodedHeader = encodeBase64urlJson(header);
  const encodedClaims = encodeBase64urlJson(claims);
  const signedPayload = `${encodedHeader}.${encodedClaims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signedPayload, "utf8"), privateKey).toString(
    "base64url",
  );

  return `${signedPayload}.${signature}`;
}

export function createJwtFixture({
  audience = "graphql-schema-registry",
  issuer = "https://auth.example.com",
}: {
  audience?: string;
  issuer?: string;
} = {}): JwtFixture {
  const { privateKey, verificationPublicKey } = createJwtSigningKeyPair();

  return {
    createToken(claimsOverrides: JwtClaims = {}): string {
      const claims = Object.assign(createDefaultJwtClaims({ audience, issuer }), claimsOverrides);

      return createSignedJwt({
        claims,
        privateKey,
      });
    },
    jwtVerification: {
      audience,
      issuer,
      verificationPublicKey,
    },
  };
}
