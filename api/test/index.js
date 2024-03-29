
const { execute_sql } = require('../../db');

module.exports = {

    ping: (req, res) => {

        res.json({ msg: 'ok' });

    }

}
