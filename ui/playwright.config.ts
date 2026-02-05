import type { PlaywrightTestConfig } from "@playwright/test";
import path from "path";

const fixtureDb = path.resolve(__dirname, "tests", "fixtures", "usage.sqlite");

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
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
      "bash -lc \"unset npm_config_prefix; source ~/.nvm/nvm.sh && nvm use 22 && node ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3001\"",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
    env: {
      ...process.env,
      CODEX_USAGE_DB: fixtureDb
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
