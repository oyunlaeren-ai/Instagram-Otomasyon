import type { ActionType, JobStatus } from "@shared/constants";
import type { AutomationJob } from "@shared/types";
import { nowIso } from "@shared/utils";
import type { DatabaseService } from "../../database/DatabaseService";

export class JobQueue {
  constructor(private readonly database: DatabaseService) {}

  enqueue(username: string, action: ActionType): AutomationJob {
    return this.database.createJob(username, action);
  }

  enqueueMany(usernames: string[], action: ActionType): AutomationJob[] {
    return this.database.createJobs(usernames, action);
  }

  getAll(): AutomationJob[] {
    return this.database.getJobs();
  }

  getPending(action?: ActionType): AutomationJob[] {
    return this.database.getPendingJobs(action);
  }

  get(id: number): AutomationJob | null {
    return this.database.getJob(id);
  }

  markProcessing(id: number): AutomationJob {
    return this.database.updateJob(id, { status: "processing", startedAt: nowIso() });
  }

  markSuccess(id: number, duration: number): AutomationJob {
    return this.database.updateJob(id, { status: "success", completedAt: nowIso(), error: null, duration });
  }

  markFailed(id: number, error: string, duration: number): AutomationJob {
    return this.database.updateJob(id, { status: "failed", completedAt: nowIso(), error, duration });
  }

  markUnsupported(id: number, error: string, duration: number): AutomationJob {
    return this.database.updateJob(id, { status: "unsupported", completedAt: nowIso(), error, duration });
  }

  markCancelled(id: number): AutomationJob {
    return this.database.updateJob(id, { status: "cancelled", completedAt: nowIso() });
  }

  cancelPending(action?: ActionType): void {
    this.database.cancelPendingJobs(action);
  }

  clear(): void {
    this.database.clearPendingJobs();
  }

  restoreInterrupted(): void {
    this.database.pauseProcessingJobs();
  }

  hasPending(): boolean {
    return this.database.countJobs("pending") > 0 || this.database.countJobs("processing") > 0;
  }

  counts(): Record<JobStatus, number> {
    return {
      pending: this.database.countJobs("pending"),
      processing: this.database.countJobs("processing"),
      success: this.database.countJobs("success"),
      failed: this.database.countJobs("failed"),
      cancelled: this.database.countJobs("cancelled"),
      unsupported: this.database.countJobs("unsupported")
    };
  }
}
