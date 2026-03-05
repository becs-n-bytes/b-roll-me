import { test, expect } from "@playwright/test";

test.describe("App Navigation", () => {
  test("loads the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Projects")).toBeVisible();
  });

  test("shows empty state when no projects exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  test("navigates to settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Settings")).toBeVisible();
    await expect(page.getByText("API Configuration")).toBeVisible();
  });

  test("settings page shows API key inputs", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByPlaceholder("sk-ant-...")).toBeVisible();
    await expect(page.getByPlaceholder("AIza...")).toBeVisible();
  });

  test("settings page shows sidecar test section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Sidecar Test")).toBeVisible();
    await expect(page.getByText("Download Test Clip")).toBeVisible();
  });
});

test.describe("Project Creation", () => {
  test("opens new project dialog", async ({ page }) => {
    await page.goto("/");
    await page.getByText("New Project").click();
    await expect(page.getByPlaceholder("My Video Project")).toBeVisible();
  });

  test("creates a project and navigates to it", async ({ page }) => {
    await page.goto("/");
    await page.getByText("New Project").click();
    await page.getByPlaceholder("My Video Project").fill("Test Project");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Test Project")).toBeVisible();
    await expect(page.getByText("Script")).toBeVisible();
    await expect(page.getByText("Analysis")).toBeVisible();
  });

  test("navigates back to dashboard from project", async ({ page }) => {
    await page.goto("/");
    await page.getByText("New Project").click();
    await page.getByPlaceholder("My Video Project").fill("Nav Test");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Back to projects").click();
    await expect(page.getByText("Projects")).toBeVisible();
  });
});
