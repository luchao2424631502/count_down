/**
 * db.ts — SQLite 连接 + 建表
 *
 * 读取并执行 server/schema.sql 中的 DDL（countdowns + categories + 3 索引）。
 * 使用 better-sqlite3（同步, 单用户自用足够）。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据库文件路径（默认 ./data/countdown.db，可用 DB_PATH 环境变量覆盖）
const DB_PATH =
  process.env.DB_PATH || path.resolve(__dirname, '../data/countdown.db');

// 创建数据目录
import { mkdirSync } from 'node:fs';
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** 执行 schema.sql 中的建表 DDL（幂等，含 IF NOT EXISTS） */
export function initSchema(): void {
  const schemaPath = path.resolve(__dirname, '../schema.sql');
  const ddl = readFileSync(schemaPath, 'utf-8');
  db.exec(ddl);
}

/** 仅在直接运行本文件时执行建表（pnpm db:init） */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  initSchema();
  console.log(`数据库已初始化: ${DB_PATH}`);
}

export default db;
