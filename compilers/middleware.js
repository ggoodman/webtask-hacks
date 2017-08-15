'use strict';

const META_PROP_DEBUG = 'wt-debug';
const META_PROP_MIDDLEWARE = 'wt-middleware';

module.exports = {
    compiler,
};

function compiler(options, cb) {
    const debuglog =
        (options.meta[META_PROP_DEBUG] || '')
            .split(',')
            .indexOf(META_PROP_MIDDLEWARE) >= 0
            ? console.log.bind(console)
            : () => undefined;
    const nodejsCompiler = options.nodejsCompiler;
    const script = options.script;

    // We only ever want to compile and execute the fallback
    // webtask compiler and arity handler once. We will cache it
    // in this variable if created.
    let cachedWebtaskAdapter;

    const middlewareSpecs = (options.meta[META_PROP_MIDDLEWARE] || '')
        .split(/[;,]/)
        .filter(Boolean);

    return cb(null, middlewarePipeline);

    function middlewarePipeline(ctx, req, res) {
        // Add a final middleware that will invoke the webtaskFunction
        // if not yet invoked.
        middlewareSpecs.push(function defaultMiddleware(ctx, req, res) {
            debuglog('Invoking default webtask middleware');

            if (cachedWebtaskAdapter) {
                debuglog('Using cached webtask adaptor');

                return cachedWebtaskAdapter(ctx, req, res);
            }

            return nodejsCompiler(script, (error, webtaskFn) => {
                if (error) {
                    debuglog('Error compiling webtask code: %s', error.stack);

                    return cb(error);
                }

                debuglog(
                    'Running webtask function with arity: %d',
                    webtaskFn.length
                );

                if (webtaskFn.length > 3) {
                    cachedWebtaskAdapter = (ctx, req, res) => {
                        return respondWithError(
                            new Error(
                                `Unable to execute a webtask function expecting ${webtaskFn.length} arguments`
                            ),
                            res
                        );
                    };
                } else if (webtaskFn.length === 3) {
                    // The webtask function uses the 3ary signature; no further work to do
                    cachedWebtaskAdapter = (ctx, req, res) => {
                        delete ctx.compiler;

                        return webtaskFn(ctx, req, res);
                    };
                } else {
                    // The webtask function has either the 1 or 2ary signature. First parse
                    // the body if necessary and then invoke the webtask function
                    let parseBody;
                    const bodylessMethods = ['GET', 'HEAD', 'OPTIONS'];

                    cachedWebtaskAdapter = (ctx, req, res) => {
                        // Either the body has already been parsed or the request method will never
                        // have a body.
                        if (
                            ctx.body ||
                            bodylessMethods.indexOf(req.method) !== -1
                        ) {
                            return webtaskFn.length === 2
                                ? webtaskFn(ctx, buildResponse)
                                : webtaskFn(buildResponse);
                        }

                        if (!parseBody) {
                            // Defer loading wreck until needed
                            const Wreck = require('wreck');

                            parseBody = Wreck.read.bind(Wreck);
                        }

                        // The body has yet to be parsed. Delegate this logic to wreck.
                        return parseBody(req, { json: true }, (error, body) => {
                            if (error) {
                                return buildResponse(error);
                            }

                            delete ctx.compiler;

                            ctx.body = body;

                            return webtaskFn.length === 2
                                ? webtaskFn(ctx, buildResponse)
                                : webtaskFn(buildResponse);
                        });

                        function buildResponse(error, data) {
                            if (error) {
                                return respondWithError(error, res);
                            }

                            const response = {
                                statusCode: 200,
                                headers: {},
                                data,
                            };

                            // Currently the respond function assumes json as the only format that
                            // will be sent over the wire. In the future we could inspect the request
                            // and do applicable content negotiation.
                            let json;

                            try {
                                json = JSON.stringify(response.data);
                            } catch (e) {
                                return respondWithError(
                                    new Error(
                                        "Error when JSON serializing the webtask's response data"
                                    ),
                                    res
                                );
                            }

                            response.headers['Content-Type'] =
                                'application/json';

                            res.writeHead(
                                response.statusCode,
                                response.headers
                            );
                            res.end(json);

                            return;
                        }
                    };
                }

                return cachedWebtaskAdapter(ctx, req, res);
            });
        });

        // Inject a new context object that can be used by middleware
        // to do their own compilation.
        ctx.compiler = { nodejsCompiler, script };

        let nextMiddlewareIdx = 0;

        return invokeNextMiddleware();

        function invokeNextMiddleware(error) {
            if (error) {
                debuglog(
                    'Error produced by middleware: %s',
                    error.stack || error
                );

                return respondWithError(error, res);
            }

            const middlewareSpec = middlewareSpecs[nextMiddlewareIdx];

            debuglog(
                'Invoking middleware %d: %s',
                nextMiddlewareIdx,
                middlewareSpec.name || middlewareSpec
            );

            nextMiddlewareIdx++;

            try {
                const middlewareFn = resolveCompiler(middlewareSpec);

                try {
                    return middlewareFn(ctx, req, res, invokeNextMiddleware);
                } catch (e) {
                    debuglog(
                        'Synchronous error running middleware "%s": %s',
                        middlewareSpec,
                        e.stack || e
                    );

                    return respondWithError(e, res);
                }
            } catch (e) {
                debuglog(
                    'Error loading middleware "%s": %s',
                    middlewareSpec,
                    e.stack || e
                );

                return respondWithError(e, res);
            }
        }

        function respondWithError(error, res) {
            if (!(error instanceof Error)) {
                error = new Error(
                    error.message || String(error) || 'Unknown error'
                );
            }

            if (!error.statusCode) {
                error.statusCode = 500;
            }

            const statusCode = error.statusCode;
            const headers = {
                'Content-Type': 'application/json',
            };
            const payload = {
                message: error.message,
                statusCode: error.statusCode,
            };

            [
                'code',
                'errno',
                'error',
                'error_description',
                'data',
            ].forEach(key => {
                if (error[key]) payload[key] = error[key];
            });

            if (error.statusCode === 500 && error.stack) {
                payload.stack = error.stack;
            }

            let json;

            try {
                json = JSON.stringify(payload);
            } catch (e) {
                const error = new Error(
                    'Error serializing error: ' + e.message
                );
                error.statusCode = 500;

                return respondWithError(error, res);
            }

            res.writeHead(statusCode, headers);
            res.end(json);
        }
    }
}

function resolveCompiler(spec) {
    // Already a function, no resolution to do.
    if (typeof spec === 'function') return spec;

    const idx = spec.indexOf('/');
    const moduleName = idx > -1 ? spec.substring(0, idx) : spec;
    const moduleExportName = idx > -1 ? spec.substring(idx + 1) : null;
    const module = require(moduleName);

    return moduleExportName ? module[moduleExportName] : module;
}
