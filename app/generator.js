
const db = require('../db');
const path = require('path');
const fs = require('fs');

module.exports = {

    build: async (req, res) => {

        //create stub openAPI object

        let openapi_object = module.exports.create_stub_openapi_object();

        //get public tables

        let tables = await module.exports.get_public_tables();

        //sort table names

        let table_names = [];
        for (var table of tables) {
            table_names.push(table.tablename);
        }
        table_names.sort();

        //create entities

        for (table of table_names) {
            await module.exports.create_entity(table, openapi_object);
        }

        //write the openapi json file

        let api_json_path = path.join(__dirname, '../');
        let api_json_file = `${api_json_path}/openapi.3.0.0.json`;
        fs.writeFileSync(api_json_file, JSON.stringify(openapi_object));

        res.json({ msg: 'build complete' });


    },

    get_public_tables: () => {

        let sql = `
            select * from pg_tables
            where schemaname = 'public';
        `;
        let parameters = [];
        return db.query_promise(sql, parameters);

    },

    create_entity: async (table_name, openapi_object) => {

        // get the entity name and a wrapped (double-quoted) version if the table 
        // name is reserved

        let wrapped_table_name = module.exports.wrap_reserved_table_names(table_name);

        //add the tablename as a tag to the openapi_object

        openapi_object.tags.push(
            {
                description: table_name,
                name: table_name
            }
        );

        // get foreign keys for entity

        let fks = await module.exports.get_fks_for_table(`${wrapped_table_name}`);

        //create an entity sub-folder in the API folder

        let api_path = path.join(__dirname, '../api');
        let api_entity_path = `${api_path}/${table_name}`;
        if (!fs.existsSync(api_entity_path)) {
            fs.mkdirSync(api_entity_path);
        }

        // generate code file for entity

        let scripts = [];

        let module_start = ``;
        module_start += `const db = require('../../db'); \n`;
        module_start += `\n`;
        module_start += `module.exports = { \n`;

        let module_end = `\n}`;

        scripts.push(module_start);

        let {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        } = module.exports.generate_script_get_by_id(
            table_name,
            wrapped_table_name
        );

        module.exports.attach_path_to_openapi_object(
            openapi_object,
            table_name,
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script);

        scripts.push(script);

        scripts.push(module_end);

        //write the code file to the api entity sub-folder 

        let api_entity_codefile_path = `${api_entity_path}/index.js`;

        fs.writeFileSync(
            api_entity_codefile_path,
            scripts.join('')
        );

    },

    attach_path_to_openapi_object: (
        openapi_object,
        table_name,
        description,
        api_method_path,
        rest_method,
        api_method,
        parameters,
        script
    ) => {

        openapi_object.paths[api_method_path] = {
        }

        openapi_object.paths[api_method_path][rest_method] = {
            parameters: parameters,
            description: description,
            operationId: `${table_name}/${api_method}`,
            summary: description,
            responses: {
                200: {
                    description: "successful operation",
                    "content": {
                        "application/json": {
                          "schema": {}
                        }
                      }
                },
                400: {
                    description: "Bad Request"
                }
            },
            security: [
                {
                    bearerAuth: []
                }
            ],
        }

    },

    create_stub_openapi_object: () => {

        let stub_openapi_object = {
            openapi: "3.0.0",
            info: {
                description: "OpenAPI 3.0 description",
                title: "OpenAPI 3.0 title",
                version: "1.0.0"
            },
            paths: {
                "/": {
                    get: {
                        responses: {
                            200: {
                                "description": "successful operation"
                            },
                            400: {
                                "description": "Bad Request"
                            }
                        },
                        security: [
                            {
                                "bearerAuth": []
                            }
                        ],
                        tags: [
                            "Test"
                        ],
                        description: "Ping test, returns 200 OK",
                        operationId: "test/ping",
                        summary: "Ping test, returns 200 OK."
                    }
                }
            },
            tags: [
                {
                    description: "Test",
                    name: "Test"
                }
            ],
            servers: [
                {
                    url: "/api/v1"
                }
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer"
                    }
                },
                schemas: {}
            }
        }

        return stub_openapi_object;

    },

    wrap_reserved_table_names: (table_name) => {

        if (table_name == 'user') {
            table_name = `"user"`;
        }

        return table_name;

    },

    get_fks_for_table: (table_name) => {

        // if the table name is a reserved word 'eg. user) we 
        // we can only find its foreign keys by wrapping the name in double quotes

        let sql = `
            select 
                conrelid::regclass AS table_name, 
                conname AS foreign_key, 
                pg_get_constraintdef(oid) 
            from 
                pg_constraint 
            where  
                contype = 'f' 
            and connamespace = 'public'::regnamespace  
            and conrelid::regclass::text = $1
            order by 
                conrelid::regclass::text, contype DESC;
            `;

        let parameters = [table_name];
        return db.query_promise(sql, parameters);

    },

    generate_script_get_by_id: (
        table_name,
        wrapped_table_name
    ) => {

        let description = `Get ${table_name} by id`;
        let api_method_path = `/${table_name}/{id}`;
        let rest_method = 'get';
        let parameters = [
            {
                "description": `${table_name} id`,
                "in": "path",
                "name": "id",
                "required": true,
                "schema": {
                    "type": "integer"
                }
            }
        ];

        let api_method = `get_by_id`;

        let script = `
            ${api_method}: async (req, res) => {

                try {
                    let id = parseInt(req.params.id);
                    let result = await module.exports.get_by_id_p(id);
                    res.json(result);
                }
                catch (e){
                    res.json(e);
                }

            },

            ${api_method}_p: (id) => {

                let sql = \`
                    select * from ${wrapped_table_name}
                    where id = $1;
                \`;

                let parameters = [id];
                return db.query_promise(sql, parameters);

            }
        `;

        return {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        }

    }

}