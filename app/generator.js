
const db = require('../db');
const path = require('path');
const fs = require('fs');

module.exports = {

    build: async (req, res) => {

        // generates a REST API based on the database specified in the .env file. 
        // - the generated code is written to /api, one folder per table.
        // - a json file called openapi.3.0.0.json is written to the app root.
        // after restarting the app, the API is available for use at /api/v1/api-docs.

        //create stub openAPI object

        let openapi_object = module.exports.create_stub_openapi_object();

        //get public tables from postgres

        let tables = await module.exports.get_public_tables();

        //sort table names

        let table_names = [];
        for (var table of tables) {
            table_names.push(table.tablename);
        }
        table_names.sort();

        //create entity code for each table

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

        //get a list of tables from postgres in the public schema

        let sql = `
            select * from pg_tables
            where schemaname = 'public';
        `;
        let parameters = [];
        return db.query_promise(sql, parameters);

    },

    create_entity: async (table_name, openapi_object) => {

        // get the entity name and a wrapped (double-quoted) version if the table 
        // name is a reserved word in postgres (eg. "user"). expand this list as required.

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

        // get columns for entity
        let columns = (await module.exports.
            get_columns_for_table(`${table_name}`))
            .map((column) => {
                return {
                    column_name: column.column_name,
                    data_type: column.data_type,
                    column_default: column.column_default
                }
            });

        //check if this table has an 'id' or 'uuid' or both

        let has_id_field = columns.some(column => column.column_name == 'id');
        let has_uuid_field = columns.some(column => column.column_name == 'uuid');

        // join column names with commas for SQL building.

        let column_names_array = columns
            // if the entity has a 'uuid' field, do not include the 'id' field.
            // the assumption is that if 'uuid' exists, we don't want to also leak 'id' in queries
            .filter((column) => {
                return ((column.column_name != 'id') || !has_uuid_field)
            })
            .map((column) => {
                return column.column_name
            });

        let column_names_csv = column_names_array.join(', ');

        //create an entity sub-folder in the API folder to hold our api code for this entity

        let api_path = path.join(__dirname, '../api');
        let api_entity_path = `${api_path}/${table_name}`;
        if (!fs.existsSync(api_entity_path)) {
            fs.mkdirSync(api_entity_path);
        }

        // create an array of scripts for this entity. 
        // we'll join them together and write them as a single code file later.

        let scripts = [];

        // create a module_start script (a 'header')

        let module_start = ``;
        module_start += `const db = require('../../db'); \n`;
        module_start += `\n`;
        module_start += `module.exports = { \n`;
        scripts.push(module_start);


        // each API path we generate will return script_metadata
        // which will contain the script and other assocatied info

        let script_metadata = {
            description: '',
            api_method_path: '',
            rest_method: '',
            api_method: '',
            parameters: [],
            script: ''
        };

        // - generate scripts -

        // create get_all

        script_metadata = module.exports.generate_script_get_all(table_name, columns, column_names_csv, wrapped_table_name);
        module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
        scripts.push(script_metadata.script);


        // create get_by_uuid or get_by_id

        // if this entity has a 'uuid' column, then REST access is by uuid eg. /users/{uuid}
        // otherwise, it's assumed to be 'id'.
        if (has_uuid_field) {

            // has a uuid column

            // create get_by_uuid

            script_metadata = module.exports.generate_script_get_by_uuid(table_name, columns, column_names_csv, wrapped_table_name);
            module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
            scripts.push(script_metadata.script);
        }
        else if (has_id_field) {

            //has a id column

            // create get_by_id

            script_metadata = module.exports.generate_script_get_by_id(table_name, columns, column_names_csv, wrapped_table_name);
            module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
            scripts.push(script_metadata.script);
        }


        // create insert
        script_metadata = module.exports.generate_script_insert(table_name, columns, column_names_csv, wrapped_table_name);
        module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
        scripts.push(script_metadata.script);

        // get by other columns eg. get_by_email
        // xz to do

        // get all children by uuid
        // xz to do 

        // get all by status 
        // xz to do 

        // pagesize = 10 & page = 0
        //(use SQL offset)

        // - paging
        // - sorting
        // - filter/text search


        //create a module_end script (a 'footer')

        let module_end = `\n}`;
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
        columns,
        script_metadata

    ) => {

        //attach a new endpoint to the openapi object to eventually be saved as a json file

        let {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        } = script_metadata;


        // create the path stub (if it does not exist - we add multiple items to each path, eg. get/post/put/delete)

        if (!openapi_object.paths[api_method_path]) {
            openapi_object.paths[api_method_path] = {
            }
        }

        //add the rest method

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
                },
            ],
            tags: [
                `${table_name}`
            ]
        }


        // for POSTs, attach a requestBody stub

        if (rest_method == 'post') {

            openapi_object.paths[api_method_path][rest_method]['requestBody'] = {
                content: {
                    "application/json": {
                        schema: {
                            properties: {
                            },
                            required: [
                            ],
                            type: `object`
                        }
                    }
                },
                description: `Create ${table_name}`
            }

            //populate the requestBody stub

            let properties = openapi_object.paths[api_method_path][rest_method]['requestBody']['content']['application/json']['schema']['properties'];
            let required = openapi_object.paths[api_method_path][rest_method]['requestBody']['content']['application/json']['schema']['required'];

            let data_type_convert_postgres_to_openapi = {
                'text': 'string',
                'bigint': 'integer',
                'uuid': 'string'
            }

            for (column of columns) {

                if (column.column_name != 'id') {

                    // populate properties list of requestBody

                    properties[column.column_name] = {
                        description: column.column_name,
                        type: data_type_convert_postgres_to_openapi[column.data_type] || column.data_type
                    }

                    // add example

                    switch (column.data_type) {
                        case 'text':
                            properties[column.column_name].example = column.column_name;
                            break;
                        case 'bigint':
                            properties[column.column_name].example = 0;
                            break;
                        case 'uuid':
                            properties[column.column_name].example = `00000000-0000-0000-0000-000000000000`;
                            break;
                        default:
                            properties[column.column_name].example = ``;
                            break;
                    }

                    // add format, if required

                    if (column.data_type == 'uuid') {
                        properties[column.column_name]['format'] = 'uuid';
                    }

                    // populate required array of requestBody

                    required.push(column.column_name);

                }
            }


        }

    },

    create_stub_openapi_object: () => {

        let package = require('../package.json');

        let stub_openapi_object = {
            openapi: "3.0.0",
            info: {
                description: `Interactive REST API documentation for ${package.name}`,
                title: `${package.name} REST API`,
                version: `${package.version}`
            },
            paths: {
                "/": {
                    get: {
                        responses: {
                            200: {
                                "description": "successful operation",
                                "content": {
                                    "application/json": {
                                        "schema": {}
                                    }
                                }
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

    get_columns_for_table: (table_name) => {

        let sql = `
            select *
            from information_schema.columns
            where 
                table_schema = 'public'
            and table_name = $1;                
        `;

        let parameters = [table_name];
        return db.query_promise(sql, parameters);

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

    generate_script_get_all: (
        table_name,
        columns,
        column_names_csv,
        wrapped_table_name
    ) => {

        let description = `Get all ${table_name}`;
        description += description.endsWith('s') ? 'es' : 's';

        let api_method_path = `/${table_name}/`;
        let rest_method = 'get';
        let parameters = [
            {
                "description": `pagesize (optional. default is 10, max is 100)`,
                "in": "query",
                "name": "pagesize",
                "required": false,
                "schema": {
                    "type": "integer"
                }
            },
            {
                "description": `page (optional. default is 0)`,
                "in": "query",
                "name": "page",
                "required": false,
                "schema": {
                    "type": "integer"
                }
            },
            {
                "description": `filter (searches all string fields)`,
                "in": "query",
                "name": "filter",
                "required": false,
                "schema": {
                    "type": "string"
                }
            }
        ];

        // the filter querystring paramter constructs a where clause 
        // to search all text fields with case-insensitve search

        let where_clause = ``;
        let first_where = true;
        //for all columns
        for (column of columns) {
            //which are text or uuid
            if (column.data_type == 'text') {
                //make a where clause
                where_clause += first_where ? 'where\n\t\t\t\t\t\t' : '\n\t\t\t\t\tor  ';
                where_clause += `${column.column_name} ilike $1`;
                first_where = false;
            }
        }

        let api_method = `get_all`;

        let script = `
            ${api_method}: async (req, res) => {

                try {

                    // pagesize and page

                    let pagesize = Math.min(parseInt(req.query.pagesize || 10), 100);
                    let page = parseInt(req.query.page || 0);
                    let limit = pagesize;
                    let offset = pagesize * page;

                    //filter text fields 

                    let filter = '%' + (req.query.filter || '') + '%';

                    let result = await module.exports.${api_method}_p(
                        limit, 
                        offset,
                        filter
                    );
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${table_name} ${api_method}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: (limit, offset, filter) => {

                let sql = \`
                    select 
                        ${column_names_csv} 
                    from 
                        ${wrapped_table_name}
                    ${where_clause}
                    limit $2
                    offset $3;
                \`;

                let parameters = [
                    filter,
                    limit, 
                    offset
                ];
                return db.query_promise(sql, parameters);

            },

        `;

        return {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        }

    },

    generate_script_get_by_id: (
        table_name,
        columns,
        column_names_csv,
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

                    let result = await module.exports.${api_method}_p(id);
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${table_name} ${api_method}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: (id) => {

                let sql = \`
                    select 
                        ${column_names_csv} 
                    from 
                        ${wrapped_table_name}
                    where 
                        id = $1;
                \`;

                let parameters = [id];
                return db.query_promise(sql, parameters);

            },

        `;

        return {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        }

    },

    generate_script_get_by_uuid: (
        table_name,
        columns,
        column_names_csv,
        wrapped_table_name
    ) => {

        let description = `Get ${table_name} by uuid`;
        let api_method_path = `/${table_name}/{uuid}`;
        let rest_method = 'get';
        let parameters = [
            {
                "description": `${table_name} uuid`,
                "in": "path",
                "name": "uuid",
                "required": true,
                "schema": {
                    "type": "string",
                    "format": "uuid"
                }
            }
        ];

        let api_method = `get_by_uuid`;

        let script = `
            ${api_method}: async (req, res) => {

                try {
                    let uuid = req.params.uuid;
                    let result = await module.exports.${api_method}_p(uuid);
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${table_name} ${api_method}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: (uuid) => {

                let sql = \`
                    select 
                        ${column_names_csv} 
                    from 
                        ${wrapped_table_name}
                    where 
                        uuid = $1;
                \`;

                let parameters = [uuid];
                return db.query_promise(sql, parameters);

            },

        `;

        return {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        }

    },

    generate_script_insert: (
        table_name,
        columns,
        column_names_csv,
        wrapped_table_name
    ) => {

        let description = `Insert ${table_name}`;

        let api_method_path = `/${table_name}/`;
        let rest_method = 'post';
        let parameters = [];

        let column_names_array = columns
            // do not include the 'id' field - we assume it's an auto-updating serial field
            .filter((column) => {
                return column.column_name != 'id'
            })
            .map((column) => {
                return column.column_name
            });

        let column_names_without_id = column_names_array.join(', ');

        //create a list of column parameter placeholders (eg. $1,$2,$3..)
        let dollar_index_parameter_list = ``;
        for (var i = 0; i < column_names_array.length; i++) {
            dollar_index_parameter_list += `$${(i + 1)}, `;
        }
        if (column_names_array.length) {
            dollar_index_parameter_list = dollar_index_parameter_list.slice(0, -2);
        }

        let api_method = `insert`;

        let script = `
            ${api_method}: async (req, res) => {

                let { ${column_names_without_id} } = req.body;

                try {
                    let result = await module.exports.${api_method}_p(${column_names_without_id});
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${table_name} ${api_method}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: ( ${column_names_without_id} ) => {

                let sql = \`
                    insert into ${wrapped_table_name} (
                        ${column_names_without_id} 
                    )
                    values ( 
                        ${dollar_index_parameter_list} 
                    );
                \`;

                let parameters = [
                    ${column_names_without_id} 
                ];
                return db.query_promise(sql, parameters);

            },

        `;

        return {
            description,
            api_method_path,
            rest_method,
            api_method,
            parameters,
            script
        }

    },

}