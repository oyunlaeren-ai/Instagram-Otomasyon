export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        instagramUserId TEXT,
        username TEXT,
        displayName TEXT,
        profilePicture TEXT,
        connectionStatus TEXT NOT NULL DEFAULT 'disconnected',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        displayName TEXT,
        profilePicture TEXT,
        isFollower INTEGER NOT NULL DEFAULT 0,
        isFollowing INTEGER NOT NULL DEFAULT 0,
        followedAt TEXT,
        lastActionAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS follow_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT,
        lastActionAt TEXT
      );

      CREATE TABLE IF NOT EXISTS unfollow_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT,
        lastActionAt TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId INTEGER,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        errorCode TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS list_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listId INTEGER NOT NULL,
        username TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (listId) REFERENCES lists(id)
      );
    `
  },
  {
    name: "002_duration_and_flags",
    sql: `
      ALTER TABLE automation_jobs ADD COLUMN duration INTEGER;
      ALTER TABLE automation_logs ADD COLUMN duration INTEGER;
    `
  },
  {
    name: "003_web_automation",
    sql: `
      CREATE TABLE IF NOT EXISTS web_automation_sessions (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL DEFAULT 'disconnected',
        instagramUsername TEXT,
        lastCheckedAt TEXT,
        lastError TEXT,
        updatedAt TEXT NOT NULL
      );

      INSERT INTO web_automation_sessions (id, status, instagramUsername, lastCheckedAt, lastError, updatedAt)
      VALUES (1, 'disconnected', NULL, NULL, NULL, datetime('now'));

      CREATE TABLE IF NOT EXISTS web_automation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'web',
        status TEXT NOT NULL DEFAULT 'pending',
        profileUrl TEXT,
        error TEXT,
        errorCode TEXT,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS web_automation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId INTEGER,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'web',
        status TEXT NOT NULL,
        error TEXT,
        errorCode TEXT,
        profileUrl TEXT,
        startedAt TEXT,
        completedAt TEXT,
        createdAt TEXT NOT NULL
      );
    `
  },
  {
    name: "004_web_collected_lists",
    sql: `
      CREATE TABLE IF NOT EXISTS web_collected_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceUsername TEXT NOT NULL,
        listType TEXT NOT NULL,
        username TEXT NOT NULL,
        collectedAt TEXT NOT NULL,
        UNIQUE(sourceUsername, listType, username)
      );

      CREATE TABLE IF NOT EXISTS web_collected_runs (
        sourceUsername TEXT NOT NULL,
        listType TEXT NOT NULL,
        memberCount INTEGER NOT NULL,
        collectedAt TEXT NOT NULL,
        PRIMARY KEY (sourceUsername, listType)
      );
    `
  }
];
