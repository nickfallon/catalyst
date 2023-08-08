


module.exports = {

    create_api_routes: (app) => {

        const fs = require("fs");

        //create controllers list

        let folder_names =
            fs.readdirSync('./api', { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

        let controllers = {};

        for (folder_name of folder_names) {
            controllers[folder_name] = require(`../api/${folder_name}`);
        }

        //get all controllers in the api folder

        const openAPIDef = require("../openapi.3.0.0.json");
        const apiPath = openAPIDef.servers[0].url;

        Object.keys(openAPIDef.paths).forEach(path => {

            // for each path
            const pathInfo = openAPIDef.paths[path];

            // for each method (get/post/put/delete)
            Object.keys(pathInfo).forEach(restMethod => {
                // get the REST method, controller and function names from openAPI def
                const methodInfo = pathInfo[restMethod];
                const operation = methodInfo.operationId.split("/");
                const routerController = operation[0];
                const routerMethod = operation[1];
                //can be empty, auth_user or auth_admin
                const auth_type = operation[2];

                // get the path and convert {parm} to :parm so express can use it as a route
                const modifiedPath = module.exports.convertBracketsToColon(path);
                const expressPath = `${apiPath}${modifiedPath}`;

                // create an express route
                app[restMethod](
                    expressPath,
                    // validator.validate(restMethod, path),
                    // ip_monitor.capture(db, auth_type, routerController, routerMethod),
                    // authentication.authenticate_user(db, auth_type),
                    // authentication.authenticate_admin(db, auth_type),
                    // authentication.authenticate_bearer(db, auth_type),
                    controllers[routerController][routerMethod]
                );

            });

        });

    },

    convertBracketsToColon: (path) => {

        let modifiedPath = path;
        while (modifiedPath.indexOf("{") > -1) {
            const paramName = modifiedPath.substring(
                modifiedPath.lastIndexOf("{") + 1,
                modifiedPath.lastIndexOf("}")
            );
            modifiedPath = modifiedPath.replace(`{${paramName}}`, `:${paramName}`);
        }
        return modifiedPath;

    }

}