export interface StoredToken {
  accessToken: string;
  tokenType: string;
  expiresAt: string | null;
  accountKey: string;
}

export interface TokenStore {
  save(accountKey: string, token: StoredToken): Promise<void>;
  get(accountKey: string): Promise<StoredToken | null>;
  clear(accountKey: string): Promise<void>;
  hasAny(): Promise<boolean>;
}

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredToken>();

  async save(accountKey: string, token: StoredToken): Promise<void> {
    this.tokens.set(accountKey, token);
  }

  async get(accountKey: string): Promise<StoredToken | null> {
    return this.tokens.get(accountKey) ?? null;
  }

  async clear(accountKey: string): Promise<void> {
    this.tokens.delete(accountKey);
  }

  async hasAny(): Promise<boolean> {
    return this.tokens.size > 0;
  }
}

export class EncryptedFileTokenStore implements TokenStore {
  constructor(
    private readonly filePath: string,
    private readonly encrypt: (plain: string) => string,
    private readonly decrypt: (cipher: string) => string,
    private readonly fs: {
      existsSync: (path: string) => boolean;
      readFileSync: (path: string, encoding: BufferEncoding) => string;
      writeFileSync: (path: string, data: string) => void;
      mkdirSync: (path: string, options: { recursive: boolean }) => void;
    },
    private readonly path: { dirname: (path: string) => string }
  ) {}

  async save(accountKey: string, token: StoredToken): Promise<void> {
    const all = await this.readAll();
    all[accountKey] = token;
    await this.writeAll(all);
  }

  async get(accountKey: string): Promise<StoredToken | null> {
    const all = await this.readAll();
    return all[accountKey] ?? null;
  }

  async clear(accountKey: string): Promise<void> {
    const all = await this.readAll();
    delete all[accountKey];
    await this.writeAll(all);
  }

  async hasAny(): Promise<boolean> {
    return Object.keys(await this.readAll()).length > 0;
  }

  private async readAll(): Promise<Record<string, StoredToken>> {
    if (!this.fs.existsSync(this.filePath)) {
      return {};
    }
    const encrypted = this.fs.readFileSync(this.filePath, "utf8");
    if (!encrypted) {
      return {};
    }
    const json = this.decrypt(encrypted);
    return JSON.parse(json) as Record<string, StoredToken>;
  }

  private async writeAll(tokens: Record<string, StoredToken>): Promise<void> {
    this.fs.mkdirSync(this.path.dirname(this.filePath), { recursive: true });
    const json = JSON.stringify(tokens);
    this.fs.writeFileSync(this.filePath, this.encrypt(json));
  }
}

export const DEFAULT_TOKEN_ACCOUNT_KEY = "instagram-primary";
