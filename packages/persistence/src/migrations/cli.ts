import { closeDatabase, createDatabase } from '../db.js';
import { migrateToLatest } from './runner.js';

const db = createDatabase();
try {
  await migrateToLatest(db);
} finally {
  await closeDatabase(db);
}
