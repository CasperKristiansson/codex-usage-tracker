import { test, expect } from "@playwright/test";

test("overview loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Usage Volume")).toBeVisible();
  await expect(page.getByText("Token Mix")).toBeVisible();
});

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Tools" }).click();
  await expect(page.getByText("Tool Composition")).toBeVisible();
  await page.getByRole("link", { name: "Hotspots" }).click();
  await expect(page.getByText("Model x Directory")).toBeVisible();
  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByText("Sessions")).toBeVisible();
});

test("keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/tools/);
  await page.keyboard.press("/");
  await expect(page.getByText("Filter Command")).toBeVisible();
});
