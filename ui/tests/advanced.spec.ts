import path from "path";
import { test, expect } from "@playwright/test";

test("tools shows error rates and samples drawer", async ({ page }) => {
  const to = new Date();
  const from = new Date(to.getTime() - 12 * 60 * 60 * 1000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const errorRatesUrl = `/api/tools/error_rates?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(
    toIso
  )}&bucket=auto&topN=10`;
  const response = await page.request.get(errorRatesUrl);
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`tools error_rates failed: ${response.status()} ${body}`);
  }

  await page.goto(
    `/tools?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
      to.toISOString()
    )}&bucket=auto&topN=10`
  );

  const failures = page.getByTestId("tools-failures");
  await expect(failures).toBeVisible();

  const firstRow = failures.locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  const toolLabel = (await firstRow.locator("td").first().innerText()).trim();
  await firstRow.click();

  const drawer = page.getByTestId("tool-samples-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(`${toolLabel} samples`, { exact: false })).toBeVisible();
  await expect(drawer.getByText("Showing up to")).toBeVisible();
});

test("hotspots renders model matrix and top sessions", async ({ page }) => {
  await page.goto("/hotspots");
  await expect(page.getByTestId("hotspots-model-dir")).toBeVisible();
  await expect(page.getByTestId("hotspots-top-sessions")).toBeVisible();
});

test("settings renders db info and pricing/timezone sections", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-data-source")).toBeVisible();
  await expect(page.getByTestId("settings-timezone")).toBeVisible();
  await expect(page.getByTestId("settings-cost-model")).toBeVisible();
});

test("empty db shows empty states on overview and sessions", async ({ page }) => {
  const emptyDb = path.resolve(__dirname, "fixtures", "empty.sqlite");
  const emptySessionsUrl = `/api/sessions/list?from=2000-01-01T00:00:00%2B00:00&to=2100-01-01T00:00:00%2B00:00&bucket=auto&topN=10&page=1&pageSize=25&db=${encodeURIComponent(
    emptyDb
  )}`;
  const response = await page.request.get(emptySessionsUrl);
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`empty db sessions failed: ${response.status()} ${body}`);
  }

  await page.addInitScript((dbPath: string) => {
    window.localStorage.setItem("cut.settings", JSON.stringify({ dbPath }));
  }, emptyDb);

  await page.goto("/");
  await expect(page.getByText("No volume data for these filters.")).toBeVisible();

  await page.goto("/sessions");
  await expect(page.getByTestId("sessions-panel")).toBeVisible();
  await expect(page.getByText("No sessions for these filters.")).toBeVisible();
});
