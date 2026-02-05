import { test, expect } from "@playwright/test";

test("overview loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Usage Volume")).toBeVisible();
  await expect(page.getByText("Token Mix")).toBeVisible();
});

test("overview kpis render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("overview-kpi-total_tokens")).toBeVisible();
  await expect(page.getByTestId("overview-usage-volume")).toBeVisible();
  await expect(page.getByTestId("overview-token-mix")).toBeVisible();
});

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/from=/);
  await page.getByTestId("nav-tools").click();
  await page.waitForURL(/\/tools/);
  await expect(page.getByTestId("tools-composition")).toBeVisible();
  await page.getByTestId("nav-hotspots").click();
  await page.waitForURL(/\/hotspots/);
  await expect(page.getByTestId("hotspots-model-dir")).toBeVisible();
  await page.getByTestId("nav-sessions-and-debug").click();
  await page.waitForURL(/\/sessions/);
  await expect(page.getByTestId("sessions-panel")).toBeVisible();
  await page.getByTestId("nav-settings").click();
  await page.waitForURL(/\/settings/);
  await expect(page.getByTestId("settings-data-source")).toBeVisible();
  await page.getByTestId("nav-db-insights").click();
  await page.waitForURL(/\/db/);
  await expect(page.getByTestId("db-database")).toBeVisible();
});

test("keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("sidebar-nav").waitFor();
  await page.click("body");
  await page.keyboard.press("g");
  await page.waitForTimeout(50);
  await page.keyboard.press("t");
  await expect(page.getByTestId("tools-composition")).toBeVisible();
  await expect(page).toHaveURL(/\/tools/);
  await page.keyboard.press("/");
  await expect(page.getByText("Filter Command")).toBeVisible();
});

test("sessions drawer shows tool calls and messages", async ({ page }) => {
  await page.goto(
    "/sessions?from=2000-01-01T00:00:00+00:00&to=2100-01-01T00:00:00+00:00&bucket=auto&topN=10"
  );
  await expect(page.getByTestId("sessions-panel")).toBeVisible();

  const panel = page.getByTestId("sessions-panel");
  const sessionCell = panel.getByText("session-alpha", { exact: false });
  await expect(sessionCell).toBeVisible({ timeout: 20000 });
  await sessionCell.click();

  const drawer = page.getByTestId("session-detail-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Debug" }).click();

  await expect(drawer.getByText("Tool calls")).toBeVisible();
  await expect(drawer.getByText("git status").first()).toBeVisible();

  await drawer.getByPlaceholder("Turn index").fill("1");
  await drawer.getByRole("button", { name: "Load messages" }).click();
  await expect(drawer.getByText("Show me token usage.")).toBeVisible();
});
