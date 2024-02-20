
const db = require('../db');

module.exports = {

    authenticate_bearer_token: async (req, res, next) => {

        const bearer_token = ((req.headers.authorization || '')).split('Bearer ').join('');

        let sql = `
            select 
                bearer_token
            from 
                "user"
            where "user".bearer_token = $1;
        `;

        let parameters = [bearer_token];

        let rows = [];

        try {
            rows = await db.query_promise(sql, parameters);
        }
        catch (e) {
            console.log(`error in authentication.authenticate_bearer_token: `);
            console.log(e);
        }

        if (rows.length) {

            //valid bearer token

            next();

        }
        else {

            //invalid bearer token

            let msg = `Invalid bearer token ${bearer_token}`;
            console.log(msg);
            res.status(401);
            res.json({ error: msg });

        }

    }

}