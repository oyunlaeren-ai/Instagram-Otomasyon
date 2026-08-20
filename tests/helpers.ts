import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/main/database/DatabaseService";
import { JobQueue } from "../src/main/services/automation/JobQueue";
import { ActionLogger } from "../src/main/services/automation/ActionLogger";
import { RateLimiter } from "../src/main/services/automation/RateLimiter";
import { ActionWorker } from "../src/main/services/automation/ActionWorker";
import { AutomationManager } from "../src/main/services/automation/AutomationManager";
import { MockInstagramService } from "../src/main/services/instagram/MockInstagramService";
import type { InstagramService } from "../src/main/services/instagram/InstagramService";

export async function createTestDatabase(): Promise<{ database: DatabaseService; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iam-"));
  const database = new DatabaseService(path.join(dir, "test.sqlite"));
  await database.initialize();
  return { database, dir };
}

export function createEngine(
  database: DatabaseService,
  service: InstagramService = new MockInstagramService({ connected: true, failUsernames: ["ornek2"] }),
  delayMs = 0
) {
  const queue = new JobQueue(database);
  const logger = new ActionLogger(database);
  const limiter = new RateLimiter(delayMs, async () => undefined);
  const worker = new ActionWorker(queue, logger, limiter, () => service);
  const manager = new AutomationManager(database, queue, worker, limiter, () => service);
  return { queue, logger, limiter, worker, manager, service };
}
