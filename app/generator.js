
const db = require('../db');
const path = require('path');
const fs = require('fs');

module.exports = {

    build: async (req, res) => {

        //get public tables

        let tables = await module.exports.get_public_tables();

        //create entities

        for (var table of tables) {

            await module.exports.create_entity(table);

        }

        //create openAPI json file

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

    create_entity: async (table) => {

        // get the entity name and a wrapped (double-quoted) version if the table 
        // name is reserved

        let table_name = table.tablename;
        let wrapped_table_name = module.exports.wrap_reserved_table_names(table_name);

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

        scripts.push(module.exports.create_script_get_by_id(wrapped_table_name));

        scripts.push(module_end);

        //write the code file to the api entity sub-folder 

        let api_entity_codefile_path = `${api_entity_path}/index.js`;
        fs.writeFileSync(api_entity_codefile_path, scripts.join(''));

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

    create_script_get_by_id: (table_name) => {

        let script = `
            get_by_id: async (req, res) => {

                try {
                    let id = parseInt(req.params.id);
                    let result = await module.exports.get_by_id_p(id);
                    res.json(result);
                }
                catch (e){
                    res.json(e);
                }

            },

            get_by_id_p: (id) => {

                let sql = \`
                    select * from ${table_name}
                    where id = $1;
                \`;

                let parameters = [id];
                return db.query_promise(sql, parameters);

            }
        `;

        return script;

    }




}