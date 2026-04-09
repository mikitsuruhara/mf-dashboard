import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { schema } from "../index";
import {
  createTestDb,
  resetTestDb,
  closeTestDb,
  TEST_GROUP_ID,
  createTestGroup,
} from "../test-helpers";
import {
  getNetWorthHistory,
  getNetWorthChangeSummaries,
  type NetWorthHistoryPoint,
} from "./net-worth";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => {
  closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
  await createTestGroup(db);
});

// ============================================================
// Test helpers
// ============================================================

async function createAccount(name: string): Promise<number> {
  const now = new Date().toISOString();
  const account = await db
    .insert(schema.accounts)
    .values({ mfId: `mf_${name}`, name, type: "bank", createdAt: now, updatedAt: now })
    .returning()
    .get();
  await db
    .insert(schema.groupAccounts)
    .values({ groupId: TEST_GROUP_ID, accountId: account.id, createdAt: now, updatedAt: now })
    .run();
  return account.id;
}

async function createHolding(data: {
  accountId: number;
  name: string;
  type: "asset" | "liability";
}): Promise<number> {
  const now = new Date().toISOString();
  const holding = await db
    .insert(schema.holdings)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return holding.id;
}

async function createSnapshot(date: string): Promise<number> {
  const now = new Date().toISOString();
  const snapshot = await db
    .insert(schema.dailySnapshots)
    .values({ groupId: TEST_GROUP_ID, date, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return snapshot.id;
}

async function createHoldingValue(data: { holdingId: number; snapshotId: number; amount: number }) {
  const now = new Date().toISOString();
  await db
    .insert(schema.holdingValues)
    .values({ ...data, createdAt: now, updatedAt: now })
    .run();
}

// Seed: one asset holding + one liability holding across two snapshots
async function seedTwoSnapshots(): Promise<void> {
  const accountId = await createAccount("Main");

  const assetHoldingId = await createHolding({ accountId, name: "Fund A", type: "asset" });
  const liabilityHoldingId = await createHolding({ accountId, name: "Card", type: "liability" });

  const snap1 = await createSnapshot("2025-01-01");
  await createHoldingValue({ holdingId: assetHoldingId, snapshotId: snap1, amount: 1_000_000 });
  await createHoldingValue({ holdingId: liabilityHoldingId, snapshotId: snap1, amount: 200_000 });

  const snap2 = await createSnapshot("2025-04-01");
  await createHoldingValue({ holdingId: assetHoldingId, snapshotId: snap2, amount: 1_200_000 });
  await createHoldingValue({ holdingId: liabilityHoldingId, snapshotId: snap2, amount: 150_000 });
}

// ============================================================
// getNetWorthHistory
// ============================================================

describe("getNetWorthHistory", () => {
  it("returns empty array when no snapshots", async () => {
    const result = await getNetWorthHistory(undefined, db);
    expect(result).toEqual([]);
  });

  it("returns empty array when no group", async () => {
    await resetTestDb(db);
    const result = await getNetWorthHistory(undefined, db);
    expect(result).toEqual([]);
  });

  it("computes assets, liabilities, netWorth correctly", async () => {
    await seedTwoSnapshots();
    const result = await getNetWorthHistory(undefined, db);

    expect(result).toHaveLength(2);
    // ASC order
    expect(result[0].date).toBe("2025-01-01");
    expect(result[0].assets).toBe(1_000_000);
    expect(result[0].liabilities).toBe(200_000);
    expect(result[0].netWorth).toBe(800_000);

    expect(result[1].date).toBe("2025-04-01");
    expect(result[1].assets).toBe(1_200_000);
    expect(result[1].liabilities).toBe(150_000);
    expect(result[1].netWorth).toBe(1_050_000);
  });

  it("returns data in ascending date order", async () => {
    await seedTwoSnapshots();
    const result = await getNetWorthHistory(undefined, db);
    expect(result[0].date < result[1].date).toBe(true);
  });

  it("uses only the latest snapshot per date when there are multiple", async () => {
    const accountId = await createAccount("Main");
    const holdingId = await createHolding({ accountId, name: "Fund", type: "asset" });

    // Two snapshots on the same date — only the max id should be used
    const snap1 = await createSnapshot("2025-04-01");
    await createHoldingValue({ holdingId, snapshotId: snap1, amount: 900_000 });
    const snap2 = await createSnapshot("2025-04-01");
    await createHoldingValue({ holdingId, snapshotId: snap2, amount: 1_000_000 });

    const result = await getNetWorthHistory(undefined, db);
    expect(result).toHaveLength(1);
    expect(result[0].assets).toBe(1_000_000); // from snap2 (max id)
  });

  it("liabilities are positive magnitude in result", async () => {
    const accountId = await createAccount("Main");
    const liabilityId = await createHolding({ accountId, name: "Loan", type: "liability" });
    const snap = await createSnapshot("2025-04-01");
    await createHoldingValue({ holdingId: liabilityId, snapshotId: snap, amount: 5_000_000 });

    const result = await getNetWorthHistory(undefined, db);
    expect(result[0].liabilities).toBe(5_000_000);
    expect(result[0].netWorth).toBe(-5_000_000);
  });

  it("excludes 住宅ローン from liabilities (property not on asset side)", async () => {
    const accountId = await createAccount("Main");
    const now = new Date().toISOString();

    // Create a mortgage holding
    const mortgageId = await db
      .insert(schema.holdings)
      .values({
        accountId,
        name: "住宅ローン",
        type: "liability",
        liabilityCategory: "住宅ローン",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    // Create a credit card holding
    const cardId = await db
      .insert(schema.holdings)
      .values({
        accountId,
        name: "カード",
        type: "liability",
        liabilityCategory: "クレジットカード利用残高",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    // Asset
    const assetId = await createHolding({ accountId, name: "Fund", type: "asset" });

    const snap = await createSnapshot("2025-04-01");
    await createHoldingValue({ holdingId: mortgageId.id, snapshotId: snap, amount: 50_000_000 });
    await createHoldingValue({ holdingId: cardId.id, snapshotId: snap, amount: 100_000 });
    await createHoldingValue({ holdingId: assetId, snapshotId: snap, amount: 8_000_000 });

    const result = await getNetWorthHistory(undefined, db);
    expect(result).toHaveLength(1);
    // Mortgage excluded; only card liability counted
    expect(result[0].assets).toBe(8_000_000);
    expect(result[0].liabilities).toBe(100_000);
    expect(result[0].netWorth).toBe(7_900_000);
  });

  it("grouped: filters by current account IDs of the specified group", async () => {
    const now = new Date().toISOString();

    // Create a second group
    const otherGroupId = "other_group";
    await db
      .insert(schema.groups)
      .values({ id: otherGroupId, name: "Other", createdAt: now, updatedAt: now })
      .run();

    // Account in test group
    const accountInGroup = await createAccount("InGroup");
    // Account NOT in test group (in other group)
    const otherAccount = await db
      .insert(schema.accounts)
      .values({ mfId: "mf_other", name: "Other", type: "bank", createdAt: now, updatedAt: now })
      .returning()
      .get();
    await db
      .insert(schema.groupAccounts)
      .values({
        groupId: otherGroupId,
        accountId: otherAccount.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const holdingInGroup = await createHolding({
      accountId: accountInGroup,
      name: "Fund",
      type: "asset",
    });
    const holdingOther = await createHolding({
      accountId: otherAccount.id,
      name: "Other Fund",
      type: "asset",
    });

    const snap = await createSnapshot("2025-04-01");
    await createHoldingValue({ holdingId: holdingInGroup, snapshotId: snap, amount: 1_000_000 });
    await createHoldingValue({ holdingId: holdingOther, snapshotId: snap, amount: 500_000 });

    const result = await getNetWorthHistory({ groupId: TEST_GROUP_ID }, db);
    expect(result).toHaveLength(1);
    expect(result[0].assets).toBe(1_000_000); // only the in-group holding
  });
});

// ============================================================
// getNetWorthChangeSummaries
// ============================================================

describe("getNetWorthChangeSummaries", () => {
  it("returns all 7 periods as unavailable when no history", async () => {
    const result = await getNetWorthChangeSummaries(undefined, db);
    expect(result).toHaveLength(7);
    expect(result.every((s) => !s.available)).toBe(true);
    expect(result.every((s) => s.percentChange === null)).toBe(true);
    const periods = result.map((s) => s.period);
    expect(periods).toEqual(["1d", "1w", "1m", "3m", "6m", "1y", "3y"]);
  });

  it("returns all periods unavailable when only one data point", async () => {
    const accountId = await createAccount("Main");
    const holdingId = await createHolding({ accountId, name: "Fund", type: "asset" });
    const snap = await createSnapshot("2025-04-15");
    await createHoldingValue({ holdingId, snapshotId: snap, amount: 1_000_000 });

    const result = await getNetWorthChangeSummaries(undefined, db);
    expect(result.every((s) => !s.available)).toBe(true);
  });

  it("computes change correctly when comparison snapshot exists", async () => {
    const accountId = await createAccount("Main");
    const holdingId = await createHolding({ accountId, name: "Fund", type: "asset" });

    // Snapshot from ~13 months ago (covers all periods up to 1y)
    const snap1 = await createSnapshot("2024-01-01");
    await createHoldingValue({ holdingId, snapshotId: snap1, amount: 1_000_000 });

    // Latest snapshot
    const snap2 = await createSnapshot("2025-04-15");
    await createHoldingValue({ holdingId, snapshotId: snap2, amount: 1_200_000 });

    const result = await getNetWorthChangeSummaries(undefined, db);

    // All periods except 3y should find the 2024-01-01 snapshot as comparison
    const oneyear = result.find((s) => s.period === "1y");
    expect(oneyear?.available).toBe(true);
    expect(oneyear?.currentValue).toBe(1_200_000);
    expect(oneyear?.previousValue).toBe(1_000_000);
    expect(oneyear?.absoluteChange).toBe(200_000);
    expect(oneyear?.percentChange).toBeCloseTo(0.2);

    // 3y: no snapshot 3 years ago → unavailable
    const threeyear = result.find((s) => s.period === "3y");
    expect(threeyear?.available).toBe(false);
  });

  it("percentChange is null when previousValue is 0", async () => {
    const accountId = await createAccount("Main");
    const assetId = await createHolding({ accountId, name: "Fund", type: "asset" });
    const liabilityId = await createHolding({ accountId, name: "Loan", type: "liability" });

    // netWorth = 500 - 500 = 0 at comparison point
    const snap1 = await createSnapshot("2024-01-01");
    await createHoldingValue({ holdingId: assetId, snapshotId: snap1, amount: 500_000 });
    await createHoldingValue({ holdingId: liabilityId, snapshotId: snap1, amount: 500_000 });

    const snap2 = await createSnapshot("2025-04-15");
    await createHoldingValue({ holdingId: assetId, snapshotId: snap2, amount: 1_000_000 });
    await createHoldingValue({ holdingId: liabilityId, snapshotId: snap2, amount: 100_000 });

    const result = await getNetWorthChangeSummaries(undefined, db);
    const oneyear = result.find((s) => s.period === "1y")!;
    expect(oneyear.available).toBe(true);
    expect(oneyear.previousValue).toBe(0);
    expect(oneyear.percentChange).toBeNull();
  });

  it("finds comparison point on or before target date (not exact match required)", async () => {
    const accountId = await createAccount("Main");
    const holdingId = await createHolding({ accountId, name: "Fund", type: "asset" });

    // Snapshot slightly before 1y ago, not exactly 1y ago
    const snap1 = await createSnapshot("2024-03-01"); // ~13 months before 2025-04-15
    await createHoldingValue({ holdingId, snapshotId: snap1, amount: 800_000 });

    const snap2 = await createSnapshot("2025-04-15");
    await createHoldingValue({ holdingId, snapshotId: snap2, amount: 1_000_000 });

    const result = await getNetWorthChangeSummaries(undefined, db);
    const oneyear = result.find((s) => s.period === "1y")!;
    expect(oneyear.available).toBe(true);
    expect(oneyear.previousValue).toBe(800_000); // uses 2024-03-01 snapshot
  });
});
