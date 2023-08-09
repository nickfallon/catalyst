
// catalyst - a code generator for Node/OpenAPI/Postgres

require('dotenv').config();

// express

const express = require('express');
const compression = require('compression');
const bodyParser = require("body-parser");
const app = express();
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.urlencoded({ extended: true }));

// start server

let server;
const port = process.env.PORT || "9000";

if (process.env.localhost == 'true') {

    // use localhost SSL server

    const https = require("https");
    const fs = require("fs");
    const key = fs.readFileSync("certs/localhost-key.pem", "utf-8");
    const cert = fs.readFileSync("certs/localhost.pem", "utf-8");
    server = https.createServer({ key, cert }, app).listen(port);
    console.log(`express running on: https://localhost:${port}`);
}
else {

    // live (https)

    server = app.listen(port, () => { });
}


// api code generator. use this to generate the api code 
// and openapi specification on the first run.

let generator = require('./app/generator');
app.get('/api/generator/build', generator.build);

// try to consume the openapi specification, 
// if it exists (on second run)

try {

    // get openapi json doc

    const openapi_json_path = "./openapi.3.0.0.json"
    const openAPIDef = require(openapi_json_path);
    const apiPath = openAPIDef.servers[0].url;

    // enforce openapi validation

    const OpenApiValidator = require('express-openapi-validator');
    app.use(
        OpenApiValidator.middleware({
            apiSpec: openapi_json_path,
            validateRequests: true,
            validateResponses: true,
            ignorePaths: (path) => path.includes('/api-docs/')
        }),
    );

    // bounce openapi validation errors

    app.use((err, req, res, next) => {
        res.status(err.status || 500).json({
            message: `openapi-validator: ${err.message}`,
            errors: err.errors,
        });
    });

    // serve openapi interactive swagger docs at /api/v1/api-docs

    const swaggerUi = require("swagger-ui-express");
    const swaggerConfig = require("./routes/swaggerUI/config");
    app.use(
        `${apiPath}/api-docs`,
        swaggerUi.serve,
        swaggerUi.setup(openAPIDef, swaggerConfig)
    );

    // create express routes for api based on the openapi doc

    let routes = require("./routes");
    routes.create_api_routes(app, openAPIDef, apiPath);

}
catch (e) {
    console.log(e);
}

console.log(`generate API: https://localhost:${port}/api/generator/build`);
console.log(`API interactive docs: https://localhost:${port}/api/v1/api-docs/`);

module.exports = {
    server: server,
    app: app
}



