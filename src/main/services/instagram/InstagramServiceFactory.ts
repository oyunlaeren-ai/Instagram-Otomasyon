import { getAppConfig } from "../../config";
import { createLogger } from "../logging/logger";
import type { TokenStore } from "../security/TokenStore";
import type { InstagramService } from "./InstagramService";
import { MockInstagramService } from "./MockInstagramService";
import { OfficialInstagramService } from "./OfficialInstagramService";

const log = createLogger("[InstagramAPI]");

export class InstagramServiceFactory {
  private readonly mockFactory: () => InstagramService;
  private readonly officialFactory: () => InstagramService;

  constructor(
    tokenStore: TokenStore,
    mockFactory: () => InstagramService = () => new MockInstagramService({ connected: false }),
    officialFactory?: () => InstagramService
  ) {
    this.mockFactory = mockFactory;
    this.officialFactory = officialFactory ?? (() => new OfficialInstagramService(tokenStore));
  }

  create(): InstagramService {
    const config = getAppConfig();
    if (config.instagramProvider === "mock") {
      log.info("Using MockInstagramService (explicit INSTAGRAM_PROVIDER=mock)");
      return this.mockFactory();
    }
    log.info("Using OfficialInstagramService");
    return this.officialFactory();
  }
}
