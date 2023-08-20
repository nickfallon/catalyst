# Catalyst

A rest API generator for node/postgres

## What it does

When provided with a Postgres database (via connection details in `.env`), Catalyst does the following:

- Creates an OpenAPI specification and saves it to `openapi.3.0.0.json` in the root folder.

- Creates a REST API that consumes the OpenAPI spec and puts the autogenerated code in the `/api` folder. All API endpoints are preceded with the common path `/api/v1/`.

- Creates interactive Swagger docs at `/api/v1/api-docs`.

## Setting up
### Generating certificates

This step generates two files, `localhost.pem` and `localhost-key.pem` in the folder `certs`.
This makes the local web app work over HTTPS

Create a folder called `certs` in the main directory and move to it:

`$ mkdir certs`

`$ cd certs`

Install the `mkcert` package:

`$ brew install mkcert`

`$ mkcert -install`

Generate the key files:

`$ mkcert localhost`


### Update .env file

Rename `.env.example` to `.env` and set the postgres connection info.

## How to run

Use: 

`npm run dev`

### Generating the API 

*When running for the first time:*

In a browser, go to [https://localhost:9000/api/generator/build](https://localhost:9000/api/generator/build)

The generator connects to a postgres database using the credentials in `.env` file.
It then creates a file `openapi.3.0.0.json` and writes code to the `/api` folder to perform SQL queries.
Express routes are automatically mapped to the `/api` folder code in `index.js`.


### Using the API 

Re-start the app.

In a browser, go to  [https://localhost:9000/api/v1/api-docs](https://localhost:9000/api/v1/api-docs) to see interactive API docs.

You must provide an Authorization Bearer header (any value) to perform calls.



## Assumptions/opinions

- tables are assumed to have an `id` field of type serial (primary key), 
and optionally a `uuid` field, which should be `NOT NULL`.

- table names ending in `_status` or `_type` are assumed to have an `id` field and a description column which are iterated in an autogenerated file at `api/enums/index.js` so they can be used in code to refer to status or type values.

- `PUT` (update) API calls are not available for tables without a `uuid` field (eg. status tables).



## Features

Data types are validated and enforced by the API.

Bearer token authorization is enforced for all API calls.

Foreign keys are used to create API paths in the form `/parent/{parent_uuid}/child`.

`GET` endpoints are available for all tables, eg. `/invoice`

`GET by uuid` endpoints are generated for all tables which have a `uuid` column. 

`GET by id` endpoints are generated for all tables which have a `id` column but no `uuid` column.

`POST` (create) endpoints are available for all tables.

`PUT` (update) endpoints are available for tables with a `uuid` field.

Enums are created in `api/enums/` for all tables with names ending in `_status` or `_type`.

Re-running `/api/generator/build` will overwrite the files created in `/api` and the `openapi.3.0.0.json` file.

### Paging and filtering

GET endpoints which take no parameters (so-called 'get all' endpoints) eg. `/invoice` provide optional paging and filtering querystring parameters, as follows:

- pagesize (integer, optional) : The number of rows to be returned. Default is 10. Maximum is 100.

- page (integer, optional) : The page to be returned. Default is 0. If a non-zero page is specified, (pagesize * page) rows are skipped when performing the query.

- filter (string, optional) : Used for searching for specific data. If specified, only rows which contain the filter string in any of the `text` columns are returned. If no data can be found, an empty array is returned.


