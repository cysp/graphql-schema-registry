// oxlint-disable eslint-node/no-process-env

/// <reference types="node" />

/**
 * @param {{ setSecret(value: string): void, setOutput(name: string, value: string): void }} core
 */
export async function getNeonRolePassword(core) {
  const apiKey = requireEnv("NEON_API_KEY");
  const projectId = requireEnv("NEON_PROJECT_ID");
  const host = requireEnv("NEON_HOST");
  const role = requireEnv("NEON_ROLE_NAME");
  const database = requireEnv("NEON_DATABASE_NAME");
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;

  // Resolve the branch from the exact deployment host, never a default branch.
  const response = await fetchJson(`${projectPath}/endpoints`);
  if (!isRecord(response) || !Array.isArray(response.endpoints)) {
    throw new Error("Unexpected Neon endpoints response");
  }
  const endpoints = response.endpoints.filter(
    (endpoint) => isRecord(endpoint) && endpoint.host === host && endpoint.type === "read_write",
  );
  if (endpoints.length !== 1) {
    throw new Error("Deployment host must match exactly one Neon read-write endpoint");
  }
  /** @type {unknown} */
  const endpoint = endpoints[0];
  if (!isRecord(endpoint) || typeof endpoint.branch_id !== "string") {
    throw new Error("Unexpected Neon endpoint branch");
  }
  const branchPath = `${projectPath}/branches/${encodeURIComponent(endpoint.branch_id)}`;
  await fetchJson(`${branchPath}/databases/${encodeURIComponent(database)}`);
  await fetchJson(`${branchPath}/roles/${encodeURIComponent(role)}`);
  const result = await fetchJson(`${branchPath}/roles/${encodeURIComponent(role)}/reveal_password`);
  if (!isRecord(result) || typeof result.password !== "string" || !result.password) {
    throw new Error("Unexpected Neon password response");
  }
  const password = result.password;
  core.setSecret(password);
  if (password.includes("\r") || password.includes("\n")) {
    throw new Error("Multiline Neon passwords are not supported");
  }
  core.setOutput("password", password);

  /** @param {string} path @returns {Promise<unknown>} */
  async function fetchJson(path) {
    const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Error response bodies can contain credentials; do not log them.
      throw new Error(`Neon credential lookup failed with HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Unexpected JSON in Neon credential response");
    }
  }
}

/** @param {string} name @returns {string} */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
