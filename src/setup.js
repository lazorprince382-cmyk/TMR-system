require('dotenv').config();
const { pool } = require('./db');
const { ensureDatabase } = require('./bootstrap');

ensureDatabase()
  .then(() => console.log('Database ready. Login: admin@tmr.local / Welcome123!'))
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
