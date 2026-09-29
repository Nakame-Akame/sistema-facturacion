const { restoreBackup } = require('./sqlite-backups');

if (require.main === module) {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Uso: npm run db:restore -- <archivo-de-respaldo>');
    process.exitCode = 1;
  } else {
    restoreBackup(backupPath)
      .then(result => {
        console.log(`Base restaurada: ${result.database}`);
        if (result.safetyBackup) console.log(`Respaldo previo conservado: ${result.safetyBackup}`);
      })
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}