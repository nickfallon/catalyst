
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

//by default, postgres returns bigserial and bigint as string.
//make postgres convert bigserial and bigint (both with typeId = 20) to integer,
//so that returned objects do not break openAPI type validation.

pg.types.setTypeParser(20, parseInt);


//create a db pool object
const pool = new pg.Pool(dbConfig);

async function execute_sql(sql, parameters) {

    //calling pool.query() is a convenience method to run a query 
    //on the first available idle client and return its result

    let res = await pool.query(sql, parameters);
    return res.rows;

}

module.exports = { execute_sql };


