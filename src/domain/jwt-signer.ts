import { generateKeyPairSync, sign } from "node:crypto";

export type JwtClaims = Record<string, unknown>;
type JwtHeader = Record<string, unknown>;

export type JwtVerification = Readonly<{
  audience: string;
  issuer: string;
  verificationPublicKey: Buffer;
}>;

export type AuthJwtSigner = Readonly<{
  createToken: (claimsOverrides?: JwtClaims) => string;
  jwtVerification: JwtVerification;
}>;

type CreateAuthJwtSignerOptions = Readonly<{
  audience?: string;
  issuer?: string;
}>;

const defaultAudience = "graphql-schema-registry";
const defaultIssuer = "https://auth.example.com";
const tokenLifetimeSeconds = 300;
const issuedAtSkewSeconds = 10;

function createDefaultClaims({
  audience,
  issuer,
}: {
  audience: string;
  issuer: string;
}): JwtClaims {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    aud: audience,
    authorization_details: [],
    exp: nowSeconds + tokenLifetimeSeconds,
    iat: nowSeconds - issuedAtSkewSeconds,
    iss: issuer,
    nbf: nowSeconds - issuedAtSkewSeconds,
  };
}

function encodeBase64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createSignedJwt({
  claims,
  header,
  privateKey,
}: {
  claims: JwtClaims;
  header: JwtHeader;
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

export function createAuthJwtSigner({
  audience = defaultAudience,
  issuer = defaultIssuer,
}: CreateAuthJwtSignerOptions = {}): AuthJwtSigner {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const exportedPublicKey = publicKey.export({ format: "pem", type: "spki" });
  const verificationPublicKey =
    typeof exportedPublicKey === "string"
      ? Buffer.from(exportedPublicKey, "utf8")
      : exportedPublicKey;

  return {
    createToken(claimsOverrides: JwtClaims = {}): string {
      return createSignedJwt({
        claims: Object.assign(createDefaultClaims({ audience, issuer }), claimsOverrides),
        header: {
          alg: "RS256",
          typ: "JWT",
        },
        privateKey: privateKeyPem,
      });
    },
    jwtVerification: {
      audience,
      issuer,
      verificationPublicKey,
    },
  };
}
