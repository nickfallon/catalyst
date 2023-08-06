
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