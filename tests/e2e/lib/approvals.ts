// Intended visual changes: approved-changes.json lists screenshots the candidate may render differently
// from the reference, each with the reason. An approval names the reference commit it was made against,
// so it lapses by itself once visual-reference.sha moves on (after the change is released).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

interface Approvals {
  readonly reference: string;
  readonly changes: readonly { readonly screenshots: readonly string[]; readonly reason: string }[];
}

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = readFileSync(join(E2E_DIR, "visual-reference.sha"), "utf8").trim();
const approvals = JSON.parse(readFileSync(join(E2E_DIR, "approved-changes.json"), "utf8")) as Approvals;

function matches(pattern: string, name: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
}

/** The reason a screenshot may differ from the reference, if it is approved for the current reference. */
export function approvedChange(name: string): string | undefined {
  if (approvals.reference !== reference) return undefined;
  return approvals.changes.find((change) => change.screenshots.some((pattern) => matches(pattern, name)))?.reason;
}

/**
 * Compares the page with the reference screenshot, unless the difference is approved: then the candidate
 * screenshot is only attached to the report for review.
 */
export async function expectScreenshot(page: Page, folder: string, file: string): Promise<void> {
  const name = `${folder}/${file.replace(/\.png$/, "")}`;
  const reason = test.info().project.name === "candidate" ? approvedChange(name) : undefined;
  if (reason) {
    test.info().annotations.push({ type: "approved change", description: `${name}: ${reason}` });
    await test.info().attach(`${file} (approved change)`, { body: await page.screenshot(), contentType: "image/png" });
    return;
  }
  await expect(page).toHaveScreenshot([folder, file]);
}
