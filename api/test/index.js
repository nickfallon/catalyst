
const db = require('../../db');

module.exports = {

    ping: (req, res) => {

        res.json({ msg: 'ok' });

    }

}
