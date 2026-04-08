import type { SpendingTargetsData, SpendingTarget } from "@mf-dashboard/db/types";
import { LARGE_CATEGORY_NAME_BY_ID } from "@mf-dashboard/meta/categories";
import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Page } from "playwright";
import { debug } from "../logger.js";

export async function getSpendingTargets(page: Page): Promise<SpendingTargetsData> {
  debug("Getting spending targets from /spending_targets/edit...");

  await page.goto(mfUrls.spendingTargets, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  // テーブルが表示されるまで待機
  await page.locator("table.table-bordered").waitFor({ state: "visible", timeout: 30000 });

  const categories: SpendingTarget[] = [];

  // カテゴリ行をパース（fixed/variable判定のみ）
  const rows = page.locator("table.table-bordered tbody tr.large_category");
  const rowCount = await rows.count();

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const rowClass = (await row.getAttribute("class")) || "";

    // fixed/variable 判定
    const type: "fixed" | "variable" = rowClass.includes("fixed") ? "fixed" : "variable";

    // large_category_id の取得
    const hiddenInput = row.locator("input[name='spending_targets[][large_category_id]']");
    const idStr = await hiddenInput.getAttribute("value");
    const largeCategoryId = idStr ? Number.parseInt(idStr, 10) : 0;

    // カテゴリ名（IDからルックアップ）
    const name = LARGE_CATEGORY_NAME_BY_ID[largeCategoryId] || "";

    if (name) {
      categories.push({
        largeCategoryId,
        name,
        type,
      });
    }
  }

  debug(`  Spending targets: ${categories.length} categories`);

  return { categories };
}
