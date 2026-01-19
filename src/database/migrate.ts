import { getDatabase, closeDatabase } from './index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../migrations');

export function runMigrations(): void {
  const db = getDatabase();

  // Ensure migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get list of applied migrations
  const appliedMigrations = new Set(
    db.prepare('SELECT name FROM migrations').all().map((row) => (row as { name: string }).name)
  );

  // Get migration files
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    if (appliedMigrations.has(file)) {
      console.log(`Migration ${file} already applied, skipping`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();

    console.log(`Migration ${file} applied successfully`);
  }

  console.log('All migrations completed');
}

// Run migrations if this file is executed directly
if (process.argv[1] && process.argv[1].includes('migrate')) {
  try {
    runMigrations();
    closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    closeDatabase();
    process.exit(1);
  }
}
