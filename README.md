# Webtask hacks

A collection of experiments and hacks for getting the most (and sometimes too much) out of the [Webtask](https://webtask.io) platform.

## Compilers

### Middleware

The middleware compiler provides a mechanism to run any number of middleware prior to invoking a webtask.

A middleware is a function exported by a node module having the signature `function(ctx, req, res, next)`, where:

- `ctx` is a typical [webtask context object](https://webtask.io/docs/context) that is augmented with a `compiler` property. The `compiler` object is exposed so that a middleware can be implemented that supports [custom programming models](https://webtask.io/docs/webtask-compilers). The `compiler` property is an object that has `nodejsCompiler` and `script` properties where:
  - `nodejsCompiler` is the node.js [compiler function provided to webtask compilers](https://webtask.io/docs/webtask-compilers)
  - `script` is the underling webtask's code
- `req` is the instance of `http.IncomingRequest` for the current request
- `res` is the instance of `http.ServerResponse` for the current request
- `next` is a function with the signature `function next(error)`. A middleware function may be designed to complete the response, in which case it can omit calling `next`. A middleware may also implement authentication logic, such as the [authentication]() middleware. In this case, the middleware might invoke `next` with an `Error`. If the error has a `statusCode` property, this will be used as the response status code. Otherwise, to allow control to go to the next middleware, or to the default middleware (which compiles and invokes the webtask code), the middleware can call `next()` with no arguments.

#### Usage:

1. Set the `wt-compiler` metadata property on your webtask to `webtask-hacks/middleware`.

2. Set the `wt-node-dependencies` metadata property to the stringified JSON of an object having a `webtask-hacks` property whose value is the latest version of this module.

    ```json
    {"webtask-hacks":"1.4.1"}
    ```

2. Set the `wt-middleware` metadata property to a comma-separated list of middleware references. These references can be the name of an npm module, in which case the module's default export is used. These can also be references like `module_name/name_of_export_function`, which would be equivalent to `require('module_name').name_of_export_function`. These middleware will be invoked sequentially and the next middleware will only be invoked if the previous middleware calls `next()` without argument.

3. Optionally, set the `wt-debug` metadata property to a comma-separated list of debug references that contains `wt-middleware`. This will result in additional debug information being sent to real-time logs.

### Workflow

The workflow compiler allows you to build compound webtasks that have one of two composition models:

1. `fanout` - Run a set of child webtasks in parallel, collecting response status codes.
2. `sequence` - Run one child webtask after the other, piping the output of one into the input of the next.

#### Usage:

1. Create a webtask with code using the following structure:

    ```json
    {
        "type": "fanout | sequence",
        "nodes": [
            {
                "name": "name_of_webtask_0"
            },
            {
                "name": "name_of_webtask_1"
            },
            {
                "name": "name_of_webtask_N"
            }
        ]
    }
    ```

2. Set the `wt-compiler` metadata property on your webtask to `webtask-hacks/workflow`.

3. Set the `wt-node-dependencies` metadata property to the stringified JSON of an object having a `webtask-hacks` property whose value is the latest version of this module.

    ```json
    {"webtask-hacks":"1.4.1"}
    ```

4. Optionally, set the `wt-workflow-debug` metadata property to a number corresponding to the minimum level of logs that will be output to your webtask logs.

    Supported levels are as follows:

    ```
    20: debug
    30: info
    40: warn
    50: error
    ```

## Middleware

Using middleware requires configuring the `webtask-hacks/middleware` compiler. Please see above.

### Cron authentication

The `webtask-hacks/authenticateCron` middleware provides cron job authentication based on the assumption that only trusted agents know the webtask token that underpins a webtask cron job. The Webtask daemon will automatically invoke cron jobs with an `Authorization` header having a bearer token corresponding to the cron job's underlying webtask token. This middleware will reject requests where this does not hold true.

### Authentication

The `webtask-hacks/authenticate` middleware provides a generic authentication solution that assumes that only trusted agents can inspect the metadata of the webtask. Requests subject to this middleware will be rejected if they have a `wt-auth-secret` secret and the value of that secre does not match the bearer token in the `Authorization` header.

### JSON logging

The `webtask-hacks/jsonLogger` middleware augments the console object in Webtask so that all logic running later in the synchronous or asynchronous continuation will result in newline-delimited json having the format `{ chunk, requestId, webtaskId }` being emitted to the real-time logs. This may be useful for other middleware that might want to ship augmented logs to 3rd party services or to facilitate per-request logging by consumers of real-time logs.
