
const pg = require('pg');

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

const pool = new pg.Pool(dbConfig);

pool.on('error', function (err) {
    console.log('idle client error', err);
});

module.exports = {

    pool,

    query_callback: (sql, params, callback) => {

        if (dbConfig.debug_sql) {
            console.log(sql, params);
        }

        return pool.query(sql, params, callback);
    },

    query_response: (sql, params, res) => {

        // call postgres using sql and params
        // and return the result as a json express response

        if (dbConfig.debug_sql) {
            console.log(sql, params);
        }

        pool.query(sql, params, (err, result) => {

            if (err) {
                console.log(err);
                console.trace();
                res.json(err);
            }
            else {
                res.json(result.rows);
            }

        });
    },

    query_promise: (sql, params) => {

        // call postgres using sql and params returning a promise

        return new Promise((resolve, reject) => {

            if (dbConfig.debug_sql) {
                console.log(sql, params);
            }

            pool.query(sql, params, (err, result) => {

                if (err) {
                    console.log('========================================================================================');
                    console.log(`ERROR in query_promise: ${err.message}`);
                    console.log(sql);
                    console.log('========================================================================================');
                    reject(err);
                }
                else {
                    resolve(result.rows);
                }

            });
        });

    }

}
