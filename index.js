
// catalyst - a code generator for Node/OpenAPI/Postgres

require('dotenv').config();

const port = process.env.PORT || "9000";

//express
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

//openapi
const openapi_json_path = "./openapi.3.0.0.json"
const openAPIDef = require(openapi_json_path);
const apiPath = openAPIDef.servers[0].url;

//api code generator
let generator = require('./app/generator');
app.get('/api/generator/build', generator.build);

//openapi validation
const OpenApiValidator = require('express-openapi-validator');
app.use(
    OpenApiValidator.middleware({
        apiSpec: openapi_json_path,
        validateRequests: true,
        validateResponses: true,
        ignorePaths: (path) => path.includes('/api-docs/')
    }),
);
app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
        message: `openapi-validator: ${err.message}`,
        errors: err.errors,
    });
});

//openapi interactive swagger docs
const swaggerUi = require("swagger-ui-express");
const swaggerConfig = require("./routes/swaggerUI/config");
app.use(
    `${apiPath}/api-docs`,
    swaggerUi.serve,
    swaggerUi.setup(openAPIDef, swaggerConfig)
);

//openapi routes
let routes = require("./routes");
routes.create_api_routes(app, openAPIDef, apiPath);

console.log('to generate API: https://localhost:9000/api/generator/build');

module.exports = {
    server: server,
    app: app
}



