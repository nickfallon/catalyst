

const pg = require('pg');

let ssl = (process.env.DB_SSL != 'local');
console.log({ ssl });
pg.defaults.ssl = ssl;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    max: process.env.DB_MAX,
    idleTimeoutMillis: process.env.DB_IDLE_MILLIS,
    debug_sql: (process.env.DB_DEBUG == 'true')
}

//heroku needs SSL

let db_use_ssl = (process.env.DB_USE_SSL == 'true');
pg.defaults.ssl = db_use_ssl;
if (db_use_ssl) {
    dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = new pg.Pool(dbConfig);

module.exports = pool;


