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

## How to run

Use: 

`npm run dev`

### Generating the API 

In a browser, go to [https://localhost:9000/api/generator/build](https://localhost:9000/api/generator/build)

The generator connects to a postgres database using the credentials in `.env` file.
it creates a file openapi.3.0.0.json and writes code to the /api folder to perform SQL queries.


### Using the API 

Re-start the app.

In a browser, go to  [https://localhost:9000/api/v1/api-docs](https://localhost:9000/api/v1/api-docs) to see interactive API docs.

You must provide an Authorization Bearer header (any value) to perform calls.




