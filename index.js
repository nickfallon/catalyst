
// catalyst - a code generator for Node/OpenAPI/Postgres

require('dotenv').config();

//express
const express = require('express');
const compression = require('compression');
const port = process.env.PORT || "9000";
const app = express();

require("./routes/middleware")(app);

app.use(compression());

// start server
let server;
if (process.env.localhost == 'true') {
    //localhost SSL server
    const https = require("https");
    const fs = require("fs");
    const key = fs.readFileSync("certs/localhost-key.pem", "utf-8");
    const cert = fs.readFileSync("certs/localhost.pem", "utf-8");
    server = https.createServer({ key, cert }, app).listen(port);
    console.log(`https://localhost:${port}`);
}
else {
    //prod
    server = app.listen(port, () => { });
}

let test = require('./api/test');

// app.get('/api/v1/test', test.test);
// app.get('/', test.test);

let generator = require('./app/generator');
app.get('/api/generator/build', generator.build);

module.exports = {
    server: server,
    app: app
}

