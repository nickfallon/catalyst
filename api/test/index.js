
const pool = require('../../db/pool.js');

module.exports = {

    ping: (req, res) => {

        res.json({ msg: 'ok' });

    }

}
