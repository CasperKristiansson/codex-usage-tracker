import fs from "fs";
import path from "path";
import { test, expect, type Page } from "@playwright/test";

type PageSpec = {
  name: string;
  path: string;
  checks: string[];
};

const pages: PageSpec[] = [
  { name: "overview", path: "/", checks: ["Usage Volume", "Token Mix"] },
  { name: "context", path: "/context", checks: ["Context Histogram", "Danger Rate"] },
  { name: "tools", path: "/tools", checks: ["Tool Composition", "Failures"] },
  { name: "hotspots", path: "/hotspots", checks: ["Model x Directory", "Top Sessions"] },
  { name: "sessions", path: "/sessions", checks: ["Sessions", "Anomaly filters"] },
  { name: "settings", path: "/settings", checks: ["Data source", "Cost model"] }
];

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

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
      await page.goto(`${baseUrl}${entry.path}`);
      await waitForUi(page);
      await page.waitForTimeout(500);

      for (const check of entry.checks) {
        await expect(page.getByText(check)).toBeVisible();
      }

      const baseDir = path.join("test-results", "screenshots");
      await fs.promises.mkdir(baseDir, { recursive: true });
      const target = path.join(baseDir, `${entry.name}.png`);
      await page.screenshot({ path: target, fullPage: true });
    });
  }
});
