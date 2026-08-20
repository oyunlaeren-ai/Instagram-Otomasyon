import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createTestDatabase } from "./helpers";
import { MemoryInstagramWebDriver } from "../src/main/services/instagram/MemoryInstagramWebDriver";
import { WebInstagramAutomationService } from "../src/main/services/instagram/WebInstagramAutomationService";
import { WebListCollector } from "../src/main/services/instagram/WebListCollector";
import { toCsv } from "../src/shared/utils";
import { toXlsxBase64, toXlsxBytes } from "../src/shared/xlsx";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

async function createListHarness() {
  const { database, dir } = await createTestDatabase();
  dirs.push(dir);
  const driver = new MemoryInstagramWebDriver();
  const web = new WebInstagramAutomationService(database, driver);
  const collector = new WebListCollector(database, web, () => false, () => 0);
  return { database, driver, web, collector };
}

describe("web list extraction", () => {
  it("extracts following lists and removes duplicates", async () => {
    const { collector, driver, database } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", {
      followingList: ["@user1", "user2", "user1", "User2", "user3"]
    });
    await collector.collectFollowing("eren");
    const names = database.getWebCollectedList("eren", "FOLLOWING").map((item) => item.username);
    expect(names).toEqual(["user1", "user2", "user3"]);
  });

  it("extracts followers lists", async () => {
    const { collector, driver, database } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { followers: ["a", "b"] });
    await collector.collectFollowers("@eren");
    expect(database.getWebCollectedList("eren", "FOLLOWERS").map((item) => item.username)).toEqual(["a", "b"]);
  });

  it("paginates with scroll batches", async () => {
    const { collector, driver } = await createListHarness();
    driver.completeLogin();
    driver.pageSize = 2;
    driver.setProfile("eren", { followingList: ["u1", "u2", "u3", "u4", "u5"] });
    await collector.collectFollowing("eren");
    expect(driver.scrollRounds).toBe(3);
    expect(collector.getStatus().collected).toBe(5);
  });

  it("handles an empty list", async () => {
    const { collector, driver, database } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { followingList: [] });
    await collector.collectFollowing("eren");
    expect(database.getWebCollectedList("eren", "FOLLOWING")).toHaveLength(0);
    expect(database.hasBothWebLists("eren")).toBe(false);
    await collector.collectFollowers("eren");
    expect(database.hasBothWebLists("eren")).toBe(true);
  });

  it("reports profile not found", async () => {
    const { collector, driver } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("yok", { exists: false });
    const status = await collector.collectFollowing("yok");
    expect(status.lastError).toBe("Kullanıcı bulunamadı");
  });

  it("requires login before reading a list", async () => {
    const { collector } = await createListHarness();
    const status = await collector.collectFollowers("eren");
    expect(status.lastError).toBe("Instagram giriş gerekiyor");
    expect(status.running).toBe(false);
  });

  it("stops on a security challenge", async () => {
    const { collector, driver } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { challenge: true, followingList: ["a"] });
    const status = await collector.collectFollowing("eren");
    expect(status.lastError).toContain("Güvenlik doğrulaması");
  });

  it("stops on CAPTCHA", async () => {
    const { collector, driver } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { captcha: true });
    const status = await collector.collectFollowers("eren");
    expect(status.lastError).toBe("CAPTCHA gerekiyor");
  });

  it("exports CSV", async () => {
    const { collector, driver, database } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { followingList: ["user1", "user2"] });
    await collector.collectFollowing("eren");
    const csv = toCsv(database.getWebCollectedList("eren", "FOLLOWING").map((item) => item.username));
    expect(csv).toBe("username\nuser1\nuser2");
  });

  it("exports XLSX", () => {
    const bytes = toXlsxBytes(["user1", "user2"]);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain("user1");
    expect(xml).toContain("user2");
    expect(toXlsxBase64(["user1"]).length).toBeGreaterThan(10);
  });

  it("calculates non-followers from following minus followers", async () => {
    const { collector, driver, database } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", {
      followingList: ["a", "b", "c"],
      followers: ["a", "b"]
    });
    await collector.collectFollowing("eren");
    await collector.collectFollowers("eren");
    expect(database.getWebNonFollowers("eren").map((item) => item.username)).toEqual(["c"]);
    expect(database.hasBothWebLists("eren")).toBe(true);
  });

  it("does not show a hidden list", async () => {
    const { collector, driver } = await createListHarness();
    driver.completeLogin();
    driver.setProfile("eren", { listHidden: true, followingList: ["a"] });
    const status = await collector.collectFollowing("eren");
    expect(status.lastError).toBe("Instagram bu listeyi şu anda web oturumuna göstermiyor.");
  });
});
