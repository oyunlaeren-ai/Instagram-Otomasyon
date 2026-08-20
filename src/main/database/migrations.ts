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
  }
];
