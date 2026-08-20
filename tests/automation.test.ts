import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createEngine, createTestDatabase } from "./helpers";
import { RateLimiter } from "../src/main/services/automation/RateLimiter";
import { MockInstagramService } from "../src/main/services/instagram/MockInstagramService";
import { OfficialInstagramService } from "../src/main/services/instagram/OfficialInstagramService";
import { MemoryTokenStore } from "../src/main/services/security/TokenStore";
import { RateLimitedError, UnsupportedInstagramActionError } from "../src/shared/errors";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("automation queue", () => {
  it("creates a queue and adds jobs", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue } = createEngine(database);
    queue.enqueue("ornek", "FOLLOW");
    queue.enqueue("ayse_design", "UNFOLLOW");
    expect(queue.getAll()).toHaveLength(2);
    expect(queue.getPending()).toHaveLength(2);
  });

  it("starts and completes a successful follow job", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue, worker } = createEngine(database, new MockInstagramService({ connected: true, failUsernames: [] }));
    const job = queue.enqueue("ornek", "FOLLOW");
    const result = await worker.run(job);
    expect(result.job.status).toBe("success");
    expect(database.getLogs("success")).toHaveLength(1);
  });

  it("marks failed mock operations as failed", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue, worker } = createEngine(database);
    const job = queue.enqueue("ornek2", "FOLLOW");
    const result = await worker.run(job);
    expect(result.job.status).toBe("failed");
    expect(database.getLogs("failed")).toHaveLength(1);
  });

  it("cancels pending jobs", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue } = createEngine(database);
    const job = queue.enqueue("brand_hub", "FOLLOW");
    queue.cancelPending();
    expect(queue.get(job.id)?.status).toBe("cancelled");
  });

  it("stops a running manager", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue, manager } = createEngine(database);
    queue.enqueue("ornek", "FOLLOW");
    await manager.start("FOLLOW");
    const stopped = await manager.stop();
    expect(stopped.running).toBe(false);
  });

  it("pauses and resumes the queue", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { manager } = createEngine(database);
    const paused = await manager.pause();
    expect(paused.paused).toBe(true);
    const resumed = await manager.resume();
    expect(resumed.paused).toBe(false);
  });

  it("clears pending jobs", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const { queue, manager } = createEngine(database);
    queue.enqueue("ornek", "FOLLOW");
    await manager.clearQueue();
    expect(queue.getPending()).toHaveLength(0);
  });

  it("respects daily follow limit", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    database.saveSettings({ dailyFollowLimit: 0, workStart: "00:00", workEnd: "23:59" });
    const { queue, manager } = createEngine(database, new MockInstagramService({ connected: true, failUsernames: [] }));
    queue.enqueue("ornek", "FOLLOW");
    await manager.start("FOLLOW");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const status = manager.getStatus();
    expect(status.lastError).toBe("Günlük işlem limitine ulaşıldı.");
  });

  it("skips whitelisted users from unfollow enqueue set", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const lists = database.getLists();
    const whitelist = lists.find((list) => list.type === "whitelist");
    expect(whitelist).toBeTruthy();
    if (!whitelist) {
      return;
    }
    database.addListMember(whitelist.id, "user1");
    const blocked = new Set(database.getWhitelistedUsernames());
    const incoming = ["user1", "user2"].filter((name) => !blocked.has(name));
    expect(incoming).toEqual(["user2"]);
  });
});

describe("rate limiter", () => {
  it("waits between actions", async () => {
    const waits: number[] = [];
    const limiter = new RateLimiter(1000, async (ms) => {
      waits.push(ms);
    }, (() => {
      let current = 0;
      return () => {
        const value = current;
        current += 200;
        return value;
      };
    })());
    await limiter.waitTurn();
    await limiter.waitTurn();
    expect(waits[0]).toBe(800);
  });
});

describe("official provider", () => {
  it("does not fake follow success", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const tokens = new MemoryTokenStore();
    await tokens.save("instagram-primary", {
      accessToken: "token",
      tokenType: "bearer",
      expiresAt: null,
      accountKey: "instagram-primary"
    });
    const official = new OfficialInstagramService(tokens, {
      get: async () => {
        throw new Error("should not call graph for follow");
      }
    });
    const { queue, worker } = createEngine(database, official);
    const job = queue.enqueue("ornek", "FOLLOW");
    const result = await worker.run(job);
    expect(result.job.status).toBe("unsupported");
    expect(result.job.error).toContain("desteklenmiyor");
  });

  it("pauses when rate limited", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const service = {
      provider: "mock" as const,
      followSupported: true,
      unfollowSupported: true,
      followersListSupported: true,
      followingListSupported: true,
      getCapabilities: () => ({
        canGetProfile: true,
        canGetFollowers: true,
        canGetFollowing: true,
        canFollow: true,
        canUnfollow: true
      }),
      getConnectionStatus: async () => "connected" as const,
      getProfile: async () => {
        throw new Error("unused");
      },
      getFollowers: async () => [],
      getFollowing: async () => [],
      follow: async () => {
        throw new RateLimitedError();
      },
      unfollow: async () => {
        throw new RateLimitedError();
      },
      getMedia: async () => [],
      getComments: async () => []
    };
    const { queue, worker } = createEngine(database, service);
    const result = await worker.run(queue.enqueue("ornek", "FOLLOW"));
    expect(result.paused).toBe(true);
    expect(result.job.status).toBe("failed");
  });

  it("throws unsupported action from official service", async () => {
    const official = new OfficialInstagramService(new MemoryTokenStore());
    await expect(official.follow("ornek")).rejects.toBeInstanceOf(UnsupportedInstagramActionError);
  });
});
