const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const projectRoot = path.resolve(__dirname, '..');

function configuredPath(value) {
  return path.resolve(projectRoot, value);
}

function verifyDatabase(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error('La base de datos no pasó la comprobación de integridad.');
  } finally {
    database.close();
  }
}

async function backupToFile(sourcePath, destinationPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error('El origen y el destino del respaldo deben ser distintos.');
  if (!fs.existsSync(source)) throw new Error(`No existe la base de datos de origen: ${source}`);
  if (fs.existsSync(destination)) throw new Error(`El archivo de destino ya existe: ${destination}`);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  verifyDatabase(destination);
  return destination;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function createBackup(sourcePath = process.env.DB_PATH || 'facturacion.db', backupDirectory = process.env.BACKUP_DIR || 'backups') {
  const source = configuredPath(sourcePath);
  const directory = configuredPath(backupDirectory);
  const destination = path.join(directory, `facturacion-${timestamp()}.db`);
  return backupToFile(source, destination);
}

async function restoreBackup(backupPath, destinationPath = process.env.DB_PATH || 'facturacion.db') {
  const source = path.resolve(backupPath || '');
  const destination = configuredPath(destinationPath);
  if (!backupPath || source === destination) {
    throw new Error('Indica un respaldo válido distinto de la base de datos de destino.');
  }
  verifyDatabase(source);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stamp = timestamp();
  const temporary = `${destination}.restore-${process.pid}-${stamp}`;
  const displaced = `${destination}.previous-${process.pid}-${stamp}`;
  const safetyBackup = fs.existsSync(destination)
    ? `${destination}.before-restore-${stamp}.db`
    : null;

  try {
    await backupToFile(source, temporary);
    if (safetyBackup) await backupToFile(destination, safetyBackup);
    if (fs.existsSync(destination)) fs.renameSync(destination, displaced);
    try {
      fs.renameSync(temporary, destination);
      if (fs.existsSync(displaced)) fs.unlinkSync(displaced);
    } catch (error) {
      if (!fs.existsSync(destination) && fs.existsSync(displaced)) {
        fs.renameSync(displaced, destination);
      }
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }

  return { database: destination, safetyBackup };
}

module.exports = { createBackup, restoreBackup, verifyDatabase };