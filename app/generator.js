
const db = require('../db');
const path = require('path');
const fs = require('fs');

module.exports = {

    join: async (req, res) => {

        let origin_table = 'invoice';
        let current_table = origin_table;
        let dest_table = 'user';
        let table_chain = [];

        let data = await module.exports.recurse_join_chain(origin_table, current_table, dest_table, table_chain, ``);
        res.json(data);

    },


    build: async (req, res) => {

        console.log(`running app/generator/build()..`);

        // generates a REST API based on the database specified in the .env file. 
        // - the generated code is written to /api, one folder per table.
        // - a json file called openapi.3.0.0.json is written to the app root.
        // after restarting the app, the API is available for use at /api/v1/api-docs.

        //create stub openAPI object

        let openapi_object = module.exports.create_stub_openapi_object();

        //create enums object (for status tables)
        let enums_object = {};

        //get public tables from postgres

        let tables = await module.exports.get_public_tables();

        //sort table names

        let table_names = [];
        for (var table of tables) {
            table_names.push(table.tablename);
        }
        table_names.sort();

        //for each table

        for (table of table_names) {

            //create the entity 

            await module.exports.create_entity(table, openapi_object);

            //create enums

            await module.exports.create_enums(table, enums_object);

        }

        //write the enums api file
        let api_path = path.join(__dirname, '../api');
        let enum_path = `${api_path}/enums`;
        let enum_file_path = `${enum_path}/index.js`;
        if (!fs.existsSync(enum_path)) {
            fs.mkdirSync(enum_path);
        }

        let enums_file = `module.exports = ` + module.exports.stringify_noquotes(enums_object);
        fs.writeFileSync(enum_file_path, enums_file);

        //write the openapi json file

        let api_json_path = path.join(__dirname, '../');
        let api_json_file = `${api_json_path}/openapi.3.0.0.json`;
        fs.writeFileSync(api_json_file, JSON.stringify(openapi_object));

        console.log(`app/generator/build() complete.`);

        res.json({ msg: 'build complete' });

    },

    stringify_noquotes: (obj) => {

        // convert an object into a string, remove quotes from property names

        var cleaned = JSON.stringify(obj, null, 2);
        return cleaned.replace(/^[\t ]*"[^:\n\r]+(?<!\\)":/gm, function (match) {
            return match.replace(/"/g, "");
        });
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

    get_all_in_table: (table_name) => {

        //get all in table

        let sql = `
            select * from ${table_name};
        `;
        let parameters = [];
        return db.query_promise(sql, parameters);

    },

    get_column_info: async (table_name) => {

        let wrapped_table_name = module.exports.wrap_reserved_table_names(table_name);

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

        let has_uuid_field = columns.some(column => column.column_name == 'uuid');

        // join column names with commas for SQL building.

        let column_names_array = columns
            // if the entity has a 'uuid' field, do not include the 'id' field.
            // the assumption is that if 'uuid' exists, we don't want to also leak 'id' in queries
            .filter((column) => {
                return ((column.column_name != 'id') || !has_uuid_field)
            })
            .map((column) => {
                return `${wrapped_table_name}.${column.column_name}`
            });

        let column_names_csv = column_names_array.join(', ');

        return {
            columns,
            column_names_csv
        }

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

        // get child tables

        let children = await module.exports.get_children_of_table(`${table_name}`);

        let { columns, column_names_csv } = await module.exports.get_column_info(table_name);

        //check if this table has an 'id' or 'uuid' or both

        let has_id_field = columns.some(column => column.column_name == 'id');
        let has_uuid_field = columns.some(column => column.column_name == 'uuid');

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

        script_metadata = await module.exports.generate_script_get_all(table_name, columns, column_names_csv, wrapped_table_name);
        module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
        scripts.push(script_metadata.script);


        // create get_all_childen

        for (var child of children) {

            let child_column_info = await module.exports.get_column_info(child.table_name);
            let child_columns = child_column_info.columns;
            let child_column_names_csv = child_column_info.column_names_csv;
            let wrapped_child_table_name = module.exports.wrap_reserved_table_names(child.table_name);

            script_metadata = await module.exports.generate_script_get_all_children(
                table_name,
                child,
                child.table_name,
                child_columns,
                child_column_names_csv,
                wrapped_table_name,
                wrapped_child_table_name
            );
            module.exports.attach_path_to_openapi_object(
                openapi_object,
                table_name,
                child_columns,
                script_metadata
            );
            scripts.push(script_metadata.script);

        }

        // create get_by_uuid or get_by_id

        // if this entity has a 'uuid' column, then REST access is by uuid eg. /users/{uuid}
        // otherwise, it's assumed to be 'id'.
        if (has_uuid_field) {

            // has a uuid column

            // create get_by_uuid

            script_metadata = await module.exports.generate_script_get_by_uuid(table_name, columns, column_names_csv, wrapped_table_name);
            module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
            scripts.push(script_metadata.script);

            // create update (PUT) script
            script_metadata = await module.exports.generate_script_update_by_uuid(table_name, columns, column_names_csv, wrapped_table_name);
            module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
            scripts.push(script_metadata.script);


        }
        else if (has_id_field) {

            //has a id column

            // create get_by_id

            script_metadata = await module.exports.generate_script_get_by_id(table_name, columns, column_names_csv, wrapped_table_name);
            module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
            scripts.push(script_metadata.script);
        }


        // create insert (POST) script
        script_metadata = await module.exports.generate_script_insert(table_name, columns, column_names_csv, wrapped_table_name);
        module.exports.attach_path_to_openapi_object(openapi_object, table_name, columns, script_metadata);
        scripts.push(script_metadata.script);


        //create a module_end script (a 'footer')
        let module_end = `\n}`;
        scripts.push(module_end);

        //write the scripts to a code file in the api entity sub-folder 
        let api_entity_codefile_path = `${api_entity_path}/index.js`;
        fs.writeFileSync(api_entity_codefile_path, scripts.join(''));

    },

    create_enums: async (table_name, enums_object) => {

        //if table_name is '_status' or '_type', create enums

        if ((table_name.endsWith('_status')) || (table_name.endsWith('_type'))) {
            enums_object[table_name] = {};
            let status_records = await module.exports.get_all_in_table(table_name);
            for (var status_record of status_records) {
                let this_enum = {};
                for (var status_record_column in status_record) {
                    if (status_record_column == 'id') {
                        this_enum.value = parseInt(status_record[status_record_column]);
                    }
                    else {
                        this_enum.key = status_record[status_record_column];
                    }
                }
                enums_object[table_name][this_enum.key] = this_enum.value;
            }
        }

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

        //add the rest method to the paths 

        openapi_object.paths[api_method_path][rest_method] = {
            parameters: parameters,
            description: description,
            operationId: `${table_name}/${api_method}`,
            summary: description,
            responses: {
                200: {
                    description: "successful operation",
                    content: {
                        "application/json": {
                            schema: {
                                $ref: `#/components/schemas/${table_name}_array`
                            }
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
        };


        // for POSTs and PUTs, attach a requestBody stub

        if ((rest_method == 'post') || (rest_method == 'put')) {

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
                description: `${rest_method} ${table_name}`
            }

            //set the POST/PUT requestBody to a new schema

            openapi_object.paths[api_method_path][rest_method]['requestBody']['content']['application/json']['schema']['$ref'] =
                `#/components/schemas/${table_name}`;


            // does this entity schema already exist? (POST and PUT both use it)

            if (!openapi_object.components.schemas[table_name]) {

                // schema does not exist. add a stub for it

                // add the object schema (used for doing POST/PUTs)
                openapi_object.components.schemas[table_name] = {
                    type: "object",
                    properties: {
                    }
                };

                // add an array schema that points to the object schema
                // used for returning responses when doing GETs
                openapi_object.components.schemas[`${table_name}_array`] = {
                    type: "array",
                    items: {
                        $ref: `#/components/schemas/${table_name}`
                    }
                };

                // properties points to the entity schema properties node so we can populate it
                let properties = openapi_object.components.schemas[table_name].properties;

                let data_type_convert_postgres_to_openapi = {
                    'text': 'string',
                    'bigint': 'integer',
                    'uuid': 'string'
                }

                //create the schema

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

                    }
                }

            }

            //create required array of requestBody in path

            let required = openapi_object.paths[api_method_path][rest_method]['requestBody']['content']['application/json']['schema']['required'];
            for (column of columns) {

                if (column.column_name != 'id') {

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
                schemas: {

                },
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

        // get foreign keys of this table

        let sql = `				
			select
                tc.table_schema, 
                tc.constraint_name, 
                tc.table_name, 
                kcu.column_name, 
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            from
                information_schema.table_constraints AS tc 
            join information_schema.key_column_usage AS kcu
            on 
                tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
            join information_schema.constraint_column_usage AS ccu
            on 
                ccu.constraint_name = tc.constraint_name
            and ccu.table_schema = tc.table_schema
            where 
                tc.constraint_type = 'FOREIGN KEY' 
            and tc.table_name = $1;
            `;

        let parameters = [table_name];
        return db.query_promise(sql, parameters);

    },

    get_children_of_table: (table_name) => {

        //get children of this table (that is, tables with foreign keys pointing here)

        let sql = `				
			select
                tc.table_schema, 
                tc.constraint_name, 
                tc.table_name, 
                kcu.column_name, 
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            from
                information_schema.table_constraints AS tc 
            join information_schema.key_column_usage AS kcu
            on 
                tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
            join information_schema.constraint_column_usage AS ccu
            on 
                ccu.constraint_name = tc.constraint_name
            and ccu.table_schema = tc.table_schema
            where 
                tc.constraint_type = 'FOREIGN KEY' 
            --and tc.table_name = $1;
            and ccu.table_name = $1;
            `;

        let parameters = [table_name];
        return db.query_promise(sql, parameters);

    },

    recurse_join_chain: async (origin_table, current_table, dest_table, table_chain, sql) => {

        // in order to restrict data to only those rows that a user is entitled to see,
        // we assume that the 'origin_table' (the table that we want to retrieve from)
        // and the 'dest_table' (typically a table that describes a user)
        // can be joined either directly or indirectly to ensure that only data that 
        // the user controls is returned.

        // the current_table is initially set to the same value as origin_table and is used
        // to recurse tables. the origin_table is only required to prevent accidentally 
        // joining the origin to itself.

        // if the join chain is not direct (ie. there are other tables in between), this 
        // function discovers and constructs the necessary joins.
        // it does this by recursing tables using foreign keys until a route is 
        // discovered between the source and destination tables. 

        // circular endless recursion is prevented by passing and checking the contents of
        // the 'table_chain' parameter, which is an array of all tables in the recursion stack.

        // if recursion has found the destination table, 
        // return the chain and the sql JOIN clauses, and exit

        if (table_chain.includes(dest_table)) {

            return { table_chain, sql };

        }

        // get children (tables with foreign keys pointing to this source table)
        let children = await module.exports.get_children_of_table(`${current_table}`);

        // get parents (tables to which this source table's foreign keys point)
        let parents = await module.exports.get_fks_for_table(`${current_table}`);

        // for each child table 
        // (tables with a foreign key pointing to the current table aka current_table)

        for (var child of children) {

            //ensure the child isn't the origin table (prevent self-joins)
            if (child.table_name != origin_table) {

                // ensure the child is not in the table_chain 
                // to prevent endless recursion

                if (!table_chain.includes(child.table_name)) {

                    // clone the table chain and add the child

                    let table_chain_copy = [...table_chain];
                    table_chain_copy.push(child.table_name);

                    // recurse child table

                    let result = await module.exports.recurse_join_chain(
                        origin_table,
                        child.table_name,
                        dest_table,
                        table_chain_copy,
                        sql + `join ${child.table_name} on ${child.table_name}.${child.column_name} = ${child.foreign_table_name}.${child.foreign_column_name} \n\t\t\t\t\t`
                    );
                    if (result) {
                        return result;
                    }

                }

            }

        }

        // for each parent table 
        // (tables pointed to by a foreign key in the current table aka current_table)

        for (var parent of parents) {

            //ensure the parent isn't the origin table (prevent self-joins)
            if (parent.foreign_table_name != origin_table) {

                // ensure the parent is not in the table_chain 
                // to prevent endless recursion

                if (!table_chain.includes(parent.foreign_table_name)) {

                    //clone the table chain and add the parent

                    let table_chain_copy = [...table_chain];
                    table_chain_copy.push(parent.foreign_table_name);

                    // recurse parent table

                    let result = await module.exports.recurse_join_chain(
                        origin_table,
                        parent.foreign_table_name,
                        dest_table,
                        table_chain_copy,
                        sql + `join ${parent.foreign_table_name} on ${parent.foreign_table_name}.${parent.foreign_column_name} = ${parent.table_name}.${parent.column_name} \n\t\t\t\t\t`
                    );
                    if (result) {
                        return result;
                    }

                }

            }

        }

        //nothing found at this leaf - return null

        return null;

    },

    generate_script_get_all: async (
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
                "description": `filter (optional.searches all string fields)`,
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
        let text_field_exists = false;
        //for all columns
        for (column of columns) {
            //which are text or uuid
            if (column.data_type == 'text') {
                text_field_exists = true;
                //make a where clause
                where_clause += first_where ? 'where\n\t\t\t\t\t\t' : '\n\t\t\t\t\tor  ';
                where_clause += `${column.column_name} ilike $3`;
                first_where = false;
            }
        }
        //dummy where if no text fields to filter
        if (!text_field_exists) {
            where_clause = `where $3 = $3`;
        }

        let join_clauses = ``;

        // ==================================================================
        // create a chain of JOIN clauses to enforce selection of only those
        // records which can be joined to some specific 'restriction' table.
        // ==================================================================
        // we assume that the 'restriction' table is user.
        // this code restricts all data returned to that which can be 
        // joined, directly or indirectly, to a specific user.

        // xz to do - if this code is active, the generated sql
        // xz to do - should include a WHERE user.bearer_token = {token}
        // xz to do - or similar, to enforce authentication of this user
        // xz to do - and properly restrict data access.

        // xz to do - this code should not be used for 'super-admin' users,
        // xz to do - eg. those users who are entitled to access all data in the db.

        let restriction_table = 'user';
        let join_data;
        if (table_name != restriction_table) {
            join_data = await module.exports.recurse_join_chain(table_name, table_name, restriction_table, [], ``);
            if (join_data?.sql) {
                join_clauses = join_data.sql;
            }
        }
        // ==================================================================

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
                    console.log(\`error in ${api_method_path}\`);
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
                    ${join_clauses}
                    ${where_clause}
                    limit $1
                    offset $2;
                \`;

                let parameters = [
                    limit, 
                    offset,
                    filter
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

    generate_script_get_all_children: async (
        table_name,
        child,
        child_table_name,
        child_columns,
        child_column_names_csv,
        wrapped_table_name,
        wrapped_child_table_name
    ) => {

        //get all children of parent where the parent is table_name
        //and the child table is child_table_name.

        let description = `Get all ${child_table_name}`;
        description += description.endsWith('s') ? 'es' : 's';
        description += ` of ${table_name}`;

        let api_method_path = `/${table_name}/{id}/${child_table_name}`;
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
            },
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
                "description": `filter (optional. searches all string fields)`,
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

        let where_clause = `where`;
        let first_where = true;
        //for all child columns

        //xz to fix  - hardcoded id..

        where_clause += ` (${wrapped_table_name}.id = $1) `;


        let text_fields_exist = false;
        for (column of child_columns) {
            //which are text or uuid
            if (column.data_type == 'text') {
                text_fields_exist = true;
                //make a where clause
                where_clause += first_where ? 'and \n\t\t\t\t\t\t' : '\n\t\t\t\t\tor  ';
                where_clause += `${column.column_name} ilike $4`;
                first_where = false;
            }
        }

        //dummy where if no text fields to filter
        if (!text_fields_exist) {
            where_clause += `and $4 = $4`;
        }

        let api_method = `get_all_${child_table_name}_of_${table_name}`;

        let script = `
            ${api_method}: async (req, res) => {

                try {

                    let id = parseInt(req.params.id);

                    // pagesize and page

                    let pagesize = Math.min(parseInt(req.query.pagesize || 10), 100);
                    let page = parseInt(req.query.page || 0);
                    let limit = pagesize;
                    let offset = pagesize * page;

                    //filter text fields 

                    let filter = '%' + (req.query.filter || '') + '%';

                    let result = await module.exports.${api_method}_p(
                        id,
                        limit, 
                        offset,
                        filter
                    );
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${api_method_path}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: (id, limit, offset, filter) => {

                let sql = \`
                    select 
                        ${child_column_names_csv} 
                    from 
                        ${wrapped_child_table_name}
                    join ${wrapped_table_name} on ${wrapped_table_name}.${child.foreign_column_name} = ${wrapped_child_table_name}.${child.column_name}
                    ${where_clause}
                    limit $2
                    offset $3;
                \`;

                let parameters = [
                    id,
                    limit, 
                    offset,
                    filter
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

    generate_script_get_by_id: async (
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
                    console.log(\`error in ${api_method_path}\`);
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

    generate_script_get_by_uuid: async (
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
                    console.log(\`error in ${api_method_path}\`);
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

    generate_script_insert: async (
        table_name,
        columns,
        column_names_csv,
        wrapped_table_name
    ) => {

        let description = `Create ${table_name}`;

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
                    console.log(\`error in ${api_method_path}\`);
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

    generate_script_update_by_uuid: async (
        table_name,
        columns,
        column_names_csv,
        wrapped_table_name
    ) => {

        let description = `Update ${table_name}`;

        let api_method_path = `/${table_name}/{uuid}`;
        let rest_method = 'put';
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

        let column_names_array = columns
            // do not include the 'id' or 'uuid' field
            .filter((column) => {
                return ((column.column_name != 'id') && (column.column_name != 'uuid'))
            })
            .map((column) => {
                return column.column_name
            });

        let column_names_without_id_and_uuid = column_names_array.join(', ');

        //create string of col=$1, col=$2...
        //skip the uuid (it will be passed as a path param)
        let column_names_with_dollar_indexes = ``;
        let ix = 2;
        for (var column_name of column_names_array) {
            column_names_with_dollar_indexes += `${column_name}=$${ix}, `;
            ix++;
        }
        //strip last comma and space
        if (column_names_array.length) {
            column_names_with_dollar_indexes = column_names_with_dollar_indexes.slice(0, -2);
        }

        let api_method = `update_by_id`;

        let script = `
            ${api_method}: async (req, res) => {

                let uuid = parseInt(req.params.uuid);

                let { ${column_names_without_id_and_uuid} } = req.body;

                try {
                    let result = await module.exports.${api_method}_p(uuid, ${column_names_without_id_and_uuid});
                    res.json(result);
                }
                catch (e){
                    console.log(\`error in ${api_method_path}\`);
                    console.log(e);
                    res.json(e);
                }

            },

            ${api_method}_p: (uuid, ${column_names_without_id_and_uuid} ) => {

                let sql = \`
                    update ${wrapped_table_name} 
                    set ${column_names_with_dollar_indexes}
                    where uuid = $1;
            
                \`;

                let parameters = [
                    uuid,
                    ${column_names_without_id_and_uuid}
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

    }


}