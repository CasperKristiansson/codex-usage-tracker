import type { PlaywrightTestConfig } from "@playwright/test";
import path from "path";

const fixtureDb = path.resolve(__dirname, "tests", "fixtures", "usage.sqlite");
const fixtureConfig = path.resolve(__dirname, "tests", "fixtures", "config.json");
const fixtureRollouts = path.resolve(__dirname, "tests", "fixtures", "rollouts");

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  // Keep Playwright artifacts out of the repo (some older artifacts were accidentally committed).
  outputDir: path.resolve(__dirname, ".playwright", "test-results"),
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      `bash -lc "unset npm_config_prefix; export CODEX_USAGE_DB='${fixtureDb}' CODEX_USAGE_CONFIG='${fixtureConfig}' CODEX_USAGE_ROLLOUTS='${fixtureRollouts}' && node ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3001"`,
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
    env: {
      ...process.env,
      CODEX_USAGE_DB: fixtureDb,
      CODEX_USAGE_ROLLOUTS: fixtureRollouts
    }
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    }
  ]
};

export default config;
