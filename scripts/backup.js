const { createBackup } = require('./sqlite-backups');

if (require.main === module) {
  createBackup()
    .then(filePath => console.log(`Respaldo verificado: ${filePath}`))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}