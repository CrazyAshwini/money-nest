import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  mockScan,
  scanResult,
  transactions,
  openEditor,
  upload,
  receipt,
  redactionLabel,
  closeEditor,
  png,
  syntheticModel,
  openScanner,
  assertNoOverflow,
} from "./fixtures";

test("uploaded receipt preview zooms locally and returns focus without changing the scan draft", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  await mockScan(
    page,
    scanResult({ accountHint: null, externalReference: null }, "Google Gemini"),
  );
  let scanRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/receipt") scanRequests++;
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic preview draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("42.81");
  const filename = "synthetic-preview-receipt.png";
  await upload(dialog, filename);
  const sheet = receipt(dialog);
  const image = sheet.locator(".receipt-preview");
  const originalURL = await image.getAttribute("src");
  expect(originalURL).toMatch(/^blob:/);
  const thumbnail = sheet.getByRole("button", {
    name: `Preview uploaded photo 1: ${filename}`,
    exact: true,
  });
  await expect(thumbnail).toHaveAttribute("type", "button");
  await thumbnail.click();
  const viewer = page.locator(".uploaded-image-modal");
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute("role", "dialog");
  await expect(viewer.getByText("Photo 1 of 1", { exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("heading", { name: `Preview: ${filename}`, exact: true }),
  ).toBeVisible();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURL!,
  );
  await expect
    .poll(() =>
      viewer
        .locator(".uploaded-image-full")
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(640);
  const originalWidth = await viewer
    .locator(".uploaded-image-full")
    .evaluate((node) => node.getBoundingClientRect().width);
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewer.getByText("200%", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      viewer
        .locator(".uploaded-image-full")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth * 1.9);
  await viewer.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(viewer.getByText("150%", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  expect(scanRequests).toBe(0);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-preview-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(thumbnail).toBeFocused();
  await expect(image).toHaveAttribute("src", originalURL!);
  expect(
    await page.evaluate(async (url) => (await fetch(url!)).ok, originalURL),
  ).toBe(true);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic preview draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "42.81",
  );
  await sheet
    .getByRole("checkbox", { name: redactionLabel, exact: true })
    .check();
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  const useDetails = sheet.getByRole("button", {
    name: "Use details",
    exact: true,
  });
  await expect(useDetails).toBeVisible();
  expect(scanRequests).toBe(1);
  const textOpener = sheet.getByRole("button", {
    name: "Preview image 1",
    exact: true,
  });
  await textOpener.click();
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await expect(textOpener).toBeFocused();
  await expect(useDetails).toBeEnabled();
  await thumbnail.click();
  await expect(viewer).toBeVisible();
  await page
    .locator(".uploaded-image-overlay")
    .click({ position: { x: 5, y: 5 } });
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await expect(useDetails).toBeEnabled();
  expect(scanRequests).toBe(1);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("uploaded receipt preview cycles three photos while retaining upload order and separate removal", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const filenames = [
    "synthetic-preview-primary.png",
    "synthetic-preview-page-2.png",
    "synthetic-preview-page-3.png",
  ];
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    const images = form.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual(filenames);
    for (const image of images)
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("consent")).toEqual(["true"]);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { accountHint: null, externalReference: null },
        "Google Gemini",
      ),
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  const sheet = await openScanner(dialog);
  await sheet
    .getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    })
    .check();
  await sheet
    .getByLabel("Payment screenshot or shopping receipt", { exact: true })
    .setInputFiles(
      filenames.map((name) => ({ name, mimeType: "image/png", buffer: png })),
    );
  const images = sheet.locator(".receipt-preview");
  const originalURLs = await images.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("src")),
  );
  expect(originalURLs).toHaveLength(3);
  expect(originalURLs.every((url) => url?.startsWith("blob:"))).toBe(true);
  const confirmation = sheet.getByRole("checkbox", {
    name: new RegExp(redactionLabel),
  });
  await confirmation.check();
  const opener = sheet.getByRole("button", {
    name: `Preview uploaded photo 2: ${filenames[1]}`,
    exact: true,
  });
  await opener.click();
  const viewer = page.locator(".uploaded-image-modal");
  await expect(viewer.getByText("Photo 2 of 3", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Next photo", exact: true }).click();
  await expect(
    viewer.getByRole("heading", {
      name: `Preview: ${filenames[2]}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("Photo 1 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("Photo 3 of 3", { exact: true })).toBeVisible();
  await viewer
    .getByRole("button", { name: "Previous photo", exact: true })
    .click();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURLs[1]!,
  );
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(confirmation).toBeChecked();
  expect(
    await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("src")),
    ),
  ).toEqual(originalURLs);
  expect(scanRequests).toBe(0);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  expect(scanRequests).toBe(1);
  await opener.click();
  await expect(viewer).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeEnabled();
  await sheet
    .getByRole("button", { name: "Remove photo 2", exact: true })
    .click();
  expect(
    await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("src")),
    ),
  ).toEqual([originalURLs[0], originalURLs[2]]);
  await expect(sheet.getByText(filenames[1], { exact: true })).toHaveCount(0);
  await expect(confirmation).not.toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        return (await fetch(url!)).ok;
      } catch {
        return false;
      }
    }, originalURLs[1]),
  ).toBe(false);
  const remainingOpener = sheet.getByRole("button", {
    name: `Preview uploaded photo 2: ${filenames[2]}`,
    exact: true,
  });
  await remainingOpener.click();
  await expect(viewer.getByText("Photo 2 of 2", { exact: true })).toBeVisible();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURLs[2]!,
  );
  await page.keyboard.press("Escape");
  await expect(remainingOpener).toBeFocused();
  expect(scanRequests).toBe(1);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("uploaded receipt preview fits mobile and permits scrolling a portrait image at 300 percent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page, true, "Google Gemini");
  let scanRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/receipt") scanRequests++;
  });
  const before = await transactions(page);
  const portraitDataURL = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1800;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Synthetic portrait canvas unavailable.");
    drawing.fillStyle = "#ffffff";
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = "#176b42";
    drawing.font = "bold 40px sans-serif";
    drawing.fillText("SYNTHETIC LONG RECEIPT", 30, 80);
    drawing.font = "28px sans-serif";
    for (let index = 0; index < 22; index++) {
      drawing.fillText(
        `Fictional item ${index + 1} - INR 10.00`,
        30,
        160 + index * 64,
      );
    }
    drawing.fillText("Test only - no real payment", 30, 1700);
    return canvas.toDataURL("image/png");
  });
  const dialog = await openEditor(page);
  const sheet = await openScanner(dialog);
  const filename = "synthetic-long-preview.png";
  await sheet
    .getByLabel("Payment screenshot or shopping receipt", { exact: true })
    .setInputFiles({
      name: filename,
      mimeType: "image/png",
      buffer: Buffer.from(portraitDataURL.split(",")[1], "base64"),
    });
  const opener = sheet.getByRole("button", {
    name: `Preview uploaded photo 1: ${filename}`,
    exact: true,
  });
  await opener.click();
  const viewer = page.locator(".uploaded-image-modal");
  const viewport = viewer.locator(".uploaded-image-viewport");
  const fullImage = viewer.locator(".uploaded-image-full");
  await expect(viewer).toBeVisible();
  await expect(fullImage).toBeVisible();
  await expect
    .poll(() =>
      fullImage.evaluate((node) => (node as HTMLImageElement).naturalHeight),
    )
    .toBe(1800);
  const fit = await viewport.evaluate((node) => {
    const image = node.querySelector("img")!.getBoundingClientRect();
    return {
      width: node.clientWidth,
      height: node.clientHeight,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  });
  expect(fit.imageWidth).toBeLessThanOrEqual(fit.width + 1);
  expect(fit.imageHeight).toBeLessThanOrEqual(fit.height + 1);
  await assertNoOverflow(page);
  for (let index = 0; index < 4; index++)
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewer.getByText("300%", { exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      viewport.evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      viewport.evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBeGreaterThan(100);
  await viewport.evaluate((node) => node.scrollTo({ top: 100, left: 100 }));
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  for (const name of ["Zoom out", "Reset zoom", "Close dialog"]) {
    const bounds = await viewer
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(361);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(801);
  }
  await assertNoOverflow(page);
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-preview-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(opener).toBeFocused();
  expect(scanRequests).toBe(0);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});
