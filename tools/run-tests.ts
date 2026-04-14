import { spawn } from "node:child_process";
import { globSync } from "node:fs";

type TestSuite = "all" | "integration" | "unit";

function parseSuite(value: string): TestSuite {
  if (value === "all" || value === "integration" || value === "unit") {
    return value;
  }

  throw new Error(`Unknown test suite: ${value}`);
}

function listTestFiles(suite: TestSuite): string[] {
  const integrationTests = globSync("src/**/*.integration.test.ts").toSorted();
  const unitTests = globSync("src/**/*.test.ts")
    .filter((file) => !file.endsWith(".integration.test.ts"))
    .toSorted();

  switch (suite) {
    case "all":
      return [...unitTests, ...integrationTests];
    case "integration":
      return integrationTests;
    case "unit":
      return unitTests;
    default:
      throw new Error("Unhandled test suite");
  }
}

const [suiteArgument = "all", coverageFile = "lcov.info"] = process.argv.slice(2);
const suite = parseSuite(suiteArgument);
const testFiles = listTestFiles(suite);

if (testFiles.length === 0) {
  throw new Error(`No test files found for suite: ${suite}`);
}

const child = spawn(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--env-file-if-exists=.env.test",
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/*.fixture.ts",
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=**/*.test-support.ts",
    "--test-coverage-exclude=src/test-support/**",
    "--enable-source-maps",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${coverageFile}`,
    ...testFiles,
  ],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
