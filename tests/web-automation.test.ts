import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createTestDatabase, createEngine } from "./helpers";
import { WebInstagramAutomationService } from "../src/main/services/instagram/WebInstagramAutomationService";
import { MemoryInstagramWebDriver } from "../src/main/services/instagram/MemoryInstagramWebDriver";
import { WebAutomationEngine } from "../src/main/services/automation/WebAutomationEngine";
import { OfficialInstagramService } from "../src/main/services/instagram/OfficialInstagramService";
import { MockInstagramService } from "../src/main/services/instagram/MockInstagramService";
import { MemoryTokenStore } from "../src/main/services/security/TokenStore";
import { UnsupportedInstagramActionError } from "../src/shared/errors";
import { containsSensitiveAutomationLog, createLogger } from "../src/main/services/logging/logger";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

async function createWebHarness(delayMs = 0) {
  const { database, dir } = await createTestDatabase();
  dirs.push(dir);
  const driver = new MemoryInstagramWebDriver();
  const web = new WebInstagramAutomationService(database, driver);
  const engine = new WebAutomationEngine(database, web, () => delayMs);
  return { database, driver, web, engine };
}

async function waitUntilIdle(engine: WebAutomationEngine): Promise<void> {
  await vi.waitFor(() => {
    expect(engine.getStatus().running).toBe(false);
  });
}

describe("web automation", () => {
  it("creates a web automation service and reports disconnected session", async () => {
    const { web } = await createWebHarness();
    const snapshot = await web.getSnapshot();
    expect(snapshot.status).toBe("disconnected");
    expect(snapshot.connected).toBe(false);
    expect(snapshot.message).toBe("Bağlı değil");
  });

  it("reports login required until the user completes Instagram login", async () => {
    const { web, driver } = await createWebHarness();
    const login = await web.login();
    expect(login.status).toBe("login_required");
    expect(driver.lastOpenedUrl).toContain("instagram.com/accounts/login");
    driver.completeLogin();
    const checked = await web.checkSession();
    expect(checked.status).toBe("connected");
    expect(checked.message).toBe("Bağlı");
  });

  it("creates a follow queue and completes web follows", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    await engine.startFollow(["@kullanici1", "kullanici2"]);
    await waitUntilIdle(engine);
    const jobs = database.getWebJobs("FOLLOW");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.status === "success")).toBe(true);
    expect(driver.followCalls).toEqual(["kullanici1", "kullanici2"]);
  });

  it("creates an unfollow queue and completes web unfollows", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("kullanici1", { exists: true, following: true });
    driver.setProfile("kullanici2", { exists: true, following: true });
    await engine.startUnfollow(["kullanici1", "kullanici2"]);
    await waitUntilIdle(engine);
    const jobs = database.getWebJobs("UNFOLLOW");
    expect(jobs.every((job) => job.status === "success")).toBe(true);
    expect(driver.unfollowCalls).toEqual(["kullanici1", "kullanici2"]);
  });

  it("marks already following without clicking follow twice", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("ayse", { exists: true, following: true });
    await engine.startFollow(["ayse"]);
    await waitUntilIdle(engine);
    expect(database.getWebJobs("FOLLOW")[0]?.status).toBe("already_following");
    expect(database.getWebHistory()[0]?.provider).toBe("web");
  });

  it("marks already unfollowed when the profile is not followed", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("ayse", { exists: true, following: false });
    await engine.startUnfollow(["ayse"]);
    await waitUntilIdle(engine);
    expect(database.getWebJobs("UNFOLLOW")[0]?.status).toBe("already_unfollowed");
  });

  it("pauses and resumes the web queue", async () => {
    const { engine, driver, database } = await createWebHarness(30);
    driver.completeLogin();
    driver.actionDelayMs = 40;
    void engine.startFollow(["a", "b", "c"]);
    await vi.waitFor(() => expect(engine.getStatus().running).toBe(true));
    await engine.pause();
    expect(engine.getStatus().paused).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const duringPause = database.getWebJobs("FOLLOW").filter((job) => job.status === "pending").length;
    expect(duringPause).toBeGreaterThan(0);
    await engine.resume();
    await waitUntilIdle(engine);
    expect(database.getWebJobs("FOLLOW").every((job) => job.status === "success")).toBe(true);
  });

  it("stops remaining pending jobs", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.actionDelayMs = 60;
    void engine.startFollow(["a", "b", "c"]);
    await vi.waitFor(() => expect(engine.getStatus().running).toBe(true));
    await engine.stop();
    await waitUntilIdle(engine);
    const statuses = database.getWebJobs("FOLLOW").map((job) => job.status);
    expect(statuses).toContain("cancelled");
  });

  it("records user not found and continues", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("yok", { exists: false });
    await engine.startFollow(["yok", "var"]);
    await waitUntilIdle(engine);
    const jobs = database.getWebJobs("FOLLOW");
    expect(jobs.find((job) => job.username === "yok")?.status).toBe("user_not_found");
    expect(jobs.find((job) => job.username === "var")?.status).toBe("success");
  });

  it("stops the queue on a security challenge", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("risk", { exists: true, challenge: true });
    driver.setProfile("sonra", { exists: true, following: false });
    await engine.startFollow(["risk", "sonra"]);
    await waitUntilIdle(engine);
    expect(database.getWebJobs("FOLLOW").find((job) => job.username === "risk")?.status).toBe(
      "security_check_required"
    );
    expect(database.getWebJobs("FOLLOW").find((job) => job.username === "sonra")?.status).toBe("pending");
    expect(engine.getStatus().lastError).toContain("güvenlik doğrulaması");
  });

  it("stops the queue when CAPTCHA is required", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    driver.setProfile("bot", { exists: true, captcha: true });
    await engine.startFollow(["bot", "sonra"]);
    await waitUntilIdle(engine);
    expect(database.getWebJobs("FOLLOW")[0]?.status).toBe("security_check_required");
    expect(database.getWebJobs("FOLLOW")[1]?.status).toBe("pending");
    expect(engine.getStatus().lastError).toContain("güvenlik doğrulaması");
  });

  it("persists unfinished web jobs without auto-resuming", async () => {
    const { database, engine, web } = await createWebHarness();
    await engine.startFollow(["bekleyen"]);
    expect(engine.getStatus().running).toBe(false);
    expect(database.getWebJobs("FOLLOW")[0]?.status).toBe("pending");
    const next = new WebAutomationEngine(database, web, () => 0);
    expect(next.getStatus().running).toBe(false);
    expect(next.getStatus().interrupted).toBe(true);
  });

  it("writes web provider history without secrets", async () => {
    const { engine, driver, database } = await createWebHarness();
    driver.completeLogin();
    await engine.startFollow(["ornek"]);
    await waitUntilIdle(engine);
    const history = database.getWebHistory();
    expect(history[0]).toMatchObject({
      username: "ornek",
      action: "FOLLOW",
      provider: "web",
      status: "success"
    });
    expect(history[0]?.startedAt).toBeTruthy();
    expect(history[0]?.completedAt).toBeTruthy();
    expect(JSON.stringify(history)).not.toMatch(/password|access_token|sessionid|cookie/i);
  });
});

describe("official and mock providers stay unchanged", () => {
  it("keeps official follow and unfollow unsupported", async () => {
    const official = new OfficialInstagramService(new MemoryTokenStore());
    expect(official.followSupported).toBe(false);
    expect(official.unfollowSupported).toBe(false);
    await expect(official.follow("x")).rejects.toBeInstanceOf(UnsupportedInstagramActionError);
    await expect(official.unfollow("x")).rejects.toBeInstanceOf(UnsupportedInstagramActionError);
  });

  it("keeps mock follow behavior", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue, worker } = createEngine(database, new MockInstagramService({ connected: true, failUsernames: [] }));
    const job = queue.enqueue("ornek", "FOLLOW");
    const result = await worker.run(job);
    expect(result.job.status).toBe("success");
  });
});

describe("secret logging", () => {
  it("does not log password, token, or cookie values", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const log = createLogger("[WebAutomation]");
      log.info("password=supersecret access_token=tokencookie sessionid=abc csrftoken=def");
      log.info("ok", { cookie: "sessionid=abc", password: "x" });
    } finally {
      console.log = original;
    }
    const joined = lines.join("\n");
    expect(joined).not.toContain("supersecret");
    expect(joined).not.toContain("tokencookie");
    expect(containsSensitiveAutomationLog(joined)).toBe(false);
  });
});
