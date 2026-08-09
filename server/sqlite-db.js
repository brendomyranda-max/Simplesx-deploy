import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const plain = (obj) => (obj ? { ...obj } : obj);

class SqliteStatement {
  constructor(stmt) {
    this.stmt = stmt;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  all(...params) {
    const args = params.length ? params : this.params;
    return {
      results: this.stmt.all(...args).map(plain),
      success: true,
      meta: { rows_read: 0, rows_written: 0 },
    };
  }
  first(...params) {
    const args = params.length ? params : this.params;
    return plain(this.stmt.get(...args));
  }
  run(...params) {
    const args = params.length ? params : this.params;
    const r = this.stmt.run(...args);
    return {
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

class SqliteDb {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.execSchema();
  }
  execSchema() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL DEFAULT "")'
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const done = this.db.prepare('SELECT 1 AS ok FROM _migrations WHERE file=?').get(file);
      if (done) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _migrations (file, aplicada_em) VALUES (?,?)').run(file, new Date().toISOString());
    }
  }
  prepare(sql) {
    return new SqliteStatement(this.db.prepare(sql));
  }
  batch(statements) {
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of statements) {
        const r = s.run();
        out.push(r);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return out;
  }
  close() {
    this.db.close();
  }
}

export default SqliteDb;
