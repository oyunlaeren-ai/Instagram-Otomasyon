import { InstagramServiceError, RateLimitedError, UnsupportedInstagramActionError } from "@shared/errors";
import type { InstagramErrorCode } from "@shared/constants";
import type { AutomationJob } from "@shared/types";
import type { InstagramService } from "../instagram/InstagramService";
import type { JobQueue } from "./JobQueue";
import type { ActionLogger } from "./ActionLogger";
import type { RateLimiter } from "./RateLimiter";

export interface ActionWorkerResult {
  job: AutomationJob;
  paused: boolean;
  disconnect: boolean;
}

const UNSUPPORTED_MESSAGE = "Bu işlem mevcut Instagram API izinleriyle desteklenmiyor.";

export class ActionWorker {
  constructor(
    private readonly queue: JobQueue,
    private readonly logger: ActionLogger,
    private readonly rateLimiter: RateLimiter,
    private readonly getService: () => InstagramService
  ) {}

  async run(job: AutomationJob): Promise<ActionWorkerResult> {
    const started = Date.now();
    const processing = this.queue.markProcessing(job.id);
    const service = this.getService();
    const capabilities = service.getCapabilities();

    try {
      if (job.action === "FOLLOW" && !capabilities.canFollow) {
        throw new UnsupportedInstagramActionError("FOLLOW");
      }
      if (job.action === "UNFOLLOW" && !capabilities.canUnfollow) {
        throw new UnsupportedInstagramActionError("UNFOLLOW");
      }

      await this.rateLimiter.waitTurn();

      const result =
        job.action === "FOLLOW" ? await service.follow(job.username) : await service.unfollow(job.username);

      if (!result.success) {
        const duration = Date.now() - started;
        const failed = this.queue.markFailed(processing.id, result.error ?? UNSUPPORTED_MESSAGE, duration);
        this.logger.log({
          jobId: failed.id,
          username: failed.username,
          action: failed.action,
          status: "FAILED",
          error: failed.error,
          errorCode: result.errorCode ?? "API_ERROR",
          duration
        });
        return {
          job: failed,
          paused: result.errorCode === "RATE_LIMITED",
          disconnect: result.errorCode === "ACCOUNT_DISCONNECTED" || result.errorCode === "AUTH_REQUIRED"
        };
      }

      const duration = Date.now() - started;
      const success = this.queue.markSuccess(processing.id, duration);
      this.logger.log({
        jobId: success.id,
        username: success.username,
        action: success.action,
        status: "SUCCESS",
        duration
      });
      return { job: success, paused: false, disconnect: false };
    } catch (error) {
      const mapped = this.mapError(error);
      const duration = Date.now() - started;
      const finished =
        mapped.code === "UNSUPPORTED_ACTION"
          ? this.queue.markUnsupported(processing.id, mapped.message, duration)
          : this.queue.markFailed(processing.id, mapped.message, duration);
      this.logger.log({
        jobId: finished.id,
        username: finished.username,
        action: finished.action,
        status: mapped.code === "UNSUPPORTED_ACTION" ? "unsupported" : "FAILED",
        error: mapped.message,
        errorCode: mapped.code,
        duration
      });
      return {
        job: finished,
        paused: mapped.code === "RATE_LIMITED",
        disconnect:
          mapped.code === "ACCOUNT_DISCONNECTED" ||
          mapped.code === "AUTH_REQUIRED" ||
          mapped.code === "TOKEN_EXPIRED"
      };
    }
  }

  private mapError(error: unknown): { message: string; code: InstagramErrorCode } {
    if (error instanceof RateLimitedError) {
      return { message: error.message, code: error.code };
    }
    if (error instanceof UnsupportedInstagramActionError) {
      return { message: UNSUPPORTED_MESSAGE, code: error.code };
    }
    if (error instanceof InstagramServiceError) {
      return { message: error.message, code: error.code };
    }
    return {
      message: "İşlem sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
      code: "API_ERROR"
    };
  }
}
