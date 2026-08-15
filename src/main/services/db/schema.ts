// =============================================================
// DB Schema — 建表 / 索引 DDL
// 从 db-service.ts DBService.createTables 拆分而来（SQL 逐字搬移）
// =============================================================

type Database = import('better-sqlite3').Database

/** 建表 + 索引（幂等,全部 CREATE IF NOT EXISTS） */
export function createTables(db: Database | null): void {
  if (!db) return
  db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL,
        thinking TEXT,
        tool_calls TEXT,
        timestamp INTEGER NOT NULL,
        provider TEXT,
        model TEXT,
        token_input INTEGER,
        token_output INTEGER,
        cost REAL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
      -- OPT-3: 复合索引,避免 SELECT...WHERE session_id=? ORDER BY timestamp 的额外排序
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time ON chat_messages(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        provider TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);

      CREATE TABLE IF NOT EXISTS agent_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('running','success','failure','aborted')),
        prompt TEXT,
        output TEXT,
        error TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        cost_total REAL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON agent_executions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_executions_started_at ON agent_executions(started_at);
      -- OPT-3: 复合索引,避免 WHERE agent_id=? ORDER BY started_at DESC 的额外排序
      CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_started ON agent_executions(agent_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS cron_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_logs_task_id ON cron_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_cron_logs_timestamp ON cron_logs(timestamp);
      -- OPT-3: 复合索引,避免 WHERE task_id=? ORDER BY timestamp DESC 的额外排序
      CREATE INDEX IF NOT EXISTS idx_cron_logs_task_time ON cron_logs(task_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        grade TEXT,
        note TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        created_at INTEGER NOT NULL,
        archived_at INTEGER,
        teacher TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_classes_archived ON classes(archived);
    `)
}
