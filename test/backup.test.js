const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const test = require('node:test');
const { createBackup, restoreBackup } = require('../scripts/sqlite-backups');

test('backup can be verified and restored without losing a recovery copy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-backup-test-'));
  const databasePath = path.join(directory, 'source.db');
  const backupDirectory = path.join(directory, 'backups');

  try {
    let database = new Database(databasePath);
    database.exec('CREATE TABLE sample (value TEXT NOT NULL); INSERT INTO sample VALUES (\'original\');');
    database.close();

    const backupPath = await createBackup(databasePath, backupDirectory);
    database = new Database(databasePath);
    database.exec("INSERT INTO sample VALUES ('newer');");
    database.close();

    const result = await restoreBackup(backupPath, databasePath);
    database = new Database(databasePath, { readonly: true });
    const values = database.prepare('SELECT value FROM sample ORDER BY rowid').all();
    database.close();

    assert.deepEqual(values, [{ value: 'original' }]);
    assert.ok(result.safetyBackup);
    assert.equal(fs.existsSync(result.safetyBackup), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});