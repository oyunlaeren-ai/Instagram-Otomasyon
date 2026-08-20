import type { ActionType, InstagramErrorCode, JobStatus } from "@shared/constants";
import type { AutomationLog } from "@shared/types";
import type { DatabaseService } from "../../database/DatabaseService";
import { createLogger } from "../logging/logger";

const log = createLogger("[Automation]");

export class ActionLogger {
  constructor(private readonly database: DatabaseService) {}

  log(input: {
    jobId: number | null;
    username: string;
    action: ActionType;
    status: JobStatus | "SUCCESS" | "FAILED";
    error?: string | null;
    errorCode?: InstagramErrorCode | null;
    duration?: number | null;
  }): AutomationLog {
    const record = this.database.insertLog(input);
    log.info(`${input.action} @${input.username} ${input.status}${input.error ? ` ${input.error}` : ""}`);
    return record;
  }
}
