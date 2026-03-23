// oxlint-disable eslint/no-console
// oxlint-disable eslint-node/no-process-env

import { appendFileSync } from "node:fs";

/**
 * @typedef {object} NeonBranch
 * @property {string} id
 * @property {string} name
 *
 * @typedef {NeonBranch & { created: boolean }} NeonBranchResult
 *
 * @typedef {object} NeonEndpoint
 * @property {string} id
 * @property {string} host
 * @property {string} type
 *
 * @typedef {object} NeonBranchListResponse
 * @property {NeonBranch[]} branches
 *
 * @typedef {object} NeonBranchCreateResponse
 * @property {NeonBranch} branch
 *
 * @typedef {object} NeonEndpointsResponse
 * @property {NeonEndpoint[]} endpoints
 *
 * @typedef {object} NeonPasswordResponse
 * @property {string} password
 *
 * @typedef {object} ConnectionStringOptions
 * @property {string} host
 * @property {string} database
 * @property {string} role
 * @property {string} password
 * @property {string} sslMode
 */

const baseUrl = process.env.NEON_API_HOST ?? "https://console.neon.tech/api/v2";
const apiKey = requireEnv("NEON_API_KEY");
const projectId = requireEnv("NEON_PROJECT_ID");
const branchName = requireEnv("NEON_BRANCH_NAME");
const database = requireEnv("NEON_DATABASE_NAME");
const role = requireEnv("NEON_ROLE_NAME");
const parentBranch = process.env.NEON_PARENT_BRANCH ?? "";
const expiresAt = process.env.NEON_EXPIRES_AT ?? "";
const sslMode = process.env.NEON_SSLMODE ?? "require";
const suspendTimeoutSeconds = Number.parseInt(process.env.NEON_SUSPEND_TIMEOUT ?? "0", 10);

const defaultHeaders = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "User-Agent": "graphql-schema-registry-ci",
};

try {
  const branch = await getOrCreateBranch();
  const endpointsResponse = parseEndpointsResponse(
    await fetchJson(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/endpoints`,
    ),
  );
  const endpoint =
    endpointsResponse.endpoints.find((candidate) => candidate.type === "read_write") ??
    endpointsResponse.endpoints[0];

  await fetchJson(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/databases/${encodeURIComponent(database)}`,
  );
  await fetchJson(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/roles/${encodeURIComponent(role)}`,
  );

  const passwordResponse = parsePasswordResponse(
    await fetchJson(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/roles/${encodeURIComponent(role)}/reveal_password`,
    ),
  );
  const password = passwordResponse.password;
  const dbHostPooled = endpoint.host.replace(endpoint.id, `${endpoint.id}-pooler`);
  const dbUrl = buildConnectionString({ host: endpoint.host, database, role, password, sslMode });
  const dbUrlPooled = buildConnectionString({
    host: dbHostPooled,
    database,
    role,
    password,
    sslMode,
  });

  mask(password);
  mask(dbUrl);
  mask(dbUrlPooled);

  setOutput("created", String(branch.created));
  setOutput("branch_id", branch.id);
  setOutput("password", password);
  setOutput("db_host", endpoint.host);
  setOutput("db_host_pooled", dbHostPooled);
  setOutput("db_url", dbUrl);
  setOutput("db_url_pooled", dbUrlPooled);

  console.log(
    branch.created
      ? `Branch ${branchName} created successfully`
      : `Branch ${branchName} already exists, reusing existing branch`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

/**
 * @returns {Promise<NeonBranchResult>}
 */
async function getOrCreateBranch() {
  const existingBranch = await getBranch(branchName);
  if (existingBranch) {
    return { ...existingBranch, created: false };
  }

  /** @type {string | undefined} */
  let parentId;
  if (parentBranch) {
    const parent = await getBranch(parentBranch);
    if (!parent) {
      throw new Error(`Parent branch ${parentBranch} not found`);
    }
    parentId = parent.id;
  }

  const response = parseBranchCreateResponse(
    await fetchJson(`/projects/${encodeURIComponent(projectId)}/branches`, {
      method: "POST",
      body: JSON.stringify({
        endpoints: [
          {
            type: "read_write",
            suspend_timeout_seconds: Number.isFinite(suspendTimeoutSeconds)
              ? suspendTimeoutSeconds
              : 0,
          },
        ],
        branch: omitUndefined({
          name: branchName,
          parent_id: parentId,
          expires_at: expiresAt || undefined,
        }),
      }),
    }),
  );

  return { ...response.branch, created: true };
}

/**
 * @param {string} branchIdentifier
 * @returns {Promise<NeonBranch | undefined>}
 */
async function getBranch(branchIdentifier) {
  const response = parseBranchListResponse(
    await fetchJson(
      `/projects/${encodeURIComponent(projectId)}/branches?search=${encodeURIComponent(branchIdentifier)}&limit=10000`,
    ),
  );

  return response.branches.find(
    (branch) => branch.name === branchIdentifier || branch.id === branchIdentifier,
  );
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<unknown>}
 */
async function fetchJson(path, init = {}) {
  const headers = new Headers(defaultHeaders);
  const initHeaders = new Headers(init.headers);
  for (const [key, value] of initHeaders.entries()) {
    headers.set(key, value);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`,
    );
  }

  // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment
  const payload = await response.json();
  return payload;
}

/**
 * @param {ConnectionStringOptions} options
 * @returns {string}
 */
function buildConnectionString({ host, database, role, password, sslMode }) {
  const connectionString = new URL(`postgresql://${host}`);
  connectionString.pathname = database;
  connectionString.username = role;
  connectionString.password = password;

  if (sslMode !== "omit") {
    connectionString.searchParams.set("sslmode", sslMode);
  }

  return connectionString.toString();
}

/**
 * @param {string} value
 */
function mask(value) {
  process.stdout.write(`::add-mask::${value}\n`);
}

/**
 * @param {string} name
 * @param {string} value
 */
function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set");
  }

  appendFileSync(outputPath, `${name}<<__CODEX_EOF__\n${value}\n__CODEX_EOF__\n`);
}

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} object
 * @returns {Partial<T>}
 */
function omitUndefined(object) {
  /** @type {Partial<T>} */
  const result = {};

  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
  return typeof value === "string";
}

/**
 * @param {unknown} value
 * @returns {value is NeonBranch}
 */
function isNeonBranch(value) {
  return isRecord(value) && isString(value.id) && isString(value.name);
}

/**
 * @param {unknown} value
 * @returns {value is NeonEndpoint}
 */
function isNeonEndpoint(value) {
  return isRecord(value) && isString(value.id) && isString(value.host) && isString(value.type);
}

/**
 * @param {unknown} value
 * @returns {NeonBranchListResponse}
 */
function parseBranchListResponse(value) {
  if (!isRecord(value) || !Array.isArray(value.branches) || !value.branches.every(isNeonBranch)) {
    throw new Error("Unexpected Neon branches response");
  }

  return { branches: value.branches };
}

/**
 * @param {unknown} value
 * @returns {NeonBranchCreateResponse}
 */
function parseBranchCreateResponse(value) {
  if (!isRecord(value) || !isNeonBranch(value.branch)) {
    throw new Error("Unexpected Neon branch create response");
  }

  return { branch: value.branch };
}

/**
 * @param {unknown} value
 * @returns {NeonEndpointsResponse}
 */
function parseEndpointsResponse(value) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.endpoints) ||
    !value.endpoints.every(isNeonEndpoint)
  ) {
    throw new Error("Unexpected Neon endpoints response");
  }

  return { endpoints: value.endpoints };
}

/**
 * @param {unknown} value
 * @returns {NeonPasswordResponse}
 */
function parsePasswordResponse(value) {
  if (!isRecord(value) || !isString(value.password)) {
    throw new Error("Unexpected Neon password response");
  }

  return { password: value.password };
}
