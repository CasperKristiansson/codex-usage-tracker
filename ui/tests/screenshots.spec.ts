import fs from "fs";
import path from "path";
import { test, expect, type Page } from "@playwright/test";

type PageSpec = {
  name: string;
  path: string;
  checks: string[];
};

const pages: PageSpec[] = [
  { name: "overview", path: "/", checks: ["testid:overview-usage-volume", "testid:overview-token-mix"] },
  { name: "context", path: "/context", checks: ["testid:context-histogram", "testid:context-danger-rate"] },
  { name: "tools", path: "/tools", checks: ["testid:tools-composition", "testid:tools-failures"] },
  { name: "hotspots", path: "/hotspots", checks: ["testid:hotspots-model-dir", "testid:hotspots-top-sessions"] },
  { name: "sessions", path: "/sessions", checks: ["testid:sessions-panel", "Anomaly filters"] },
  { name: "settings", path: "/settings", checks: ["testid:settings-data-source", "testid:settings-cost-model"] }
];

const waitForUi = async (page: Page) => {
  await page.waitForFunction(() => {
    return document.querySelectorAll(".card-panel").length > 0;
  }, { timeout: 30000 });
};

test.describe("ui screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const entry of pages) {
    test(`capture ${entry.name}`, async ({ page }) => {
      await page.goto(entry.path);
      await waitForUi(page);
      await page.waitForTimeout(500);

      for (const check of entry.checks) {
        if (check.startsWith("testid:")) {
          await expect(page.getByTestId(check.replace("testid:", ""))).toBeVisible();
        } else {
          await expect(page.getByText(check)).toBeVisible();
        }
      }

      const baseDir = path.join("test-results", "screenshots");
      await fs.promises.mkdir(baseDir, { recursive: true });
      const target = path.join(baseDir, `${entry.name}.png`);
      await page.screenshot({ path: target, fullPage: true });
    });
  }
});
