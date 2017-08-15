'use strict';

const Assert = require('assert');

module.exports = {
    createMiddleware,
};

/**
 *
 * @param {object} options Options
 * @param {function} options.debuglog Debug logging function
 * @param {function} options.nodejsCompiler Default nodejs compiler
 * @param {function} options.respondWithError Function to respond with a standardized error
 * @param {string} options.script Code of the user webtask
 */
function createMiddleware(options) {
    Assert.ok(options);
    Assert.ok(options.debuglog);
    Assert.ok(options.nodejsCompiler);
    Assert.ok(options.respondWithError);
    Assert.ok(options.script);

    const debuglog = options.debuglog;
    const nodejsCompiler = options.nodejsCompiler;
    const respondWithError = options.respondWithError;
    const script = options.script;

    let cachedWebtaskAdapter;

    return function defaultMiddleware(ctx, req, res) {
        if (cachedWebtaskAdapter) {
            debuglog('Using cached webtask adaptor');

            return cachedWebtaskAdapter(ctx, req, res);
        }

        return nodejsCompiler(script, (error, webtaskFn) => {
            if (error) {
                debuglog('Error compiling webtask code: %s', error.stack);

                return respondWithError(error, res);
            }

            debuglog(
                'Running webtask function with arity: %d',
                webtaskFn.length
            );

            if (webtaskFn.length > 3) {
                cachedWebtaskAdapter = (ctx, req, res) => {
                    const error = new Error(
                        `Unable to execute a webtask function expecting ${webtaskFn.length} arguments`
                    );

                    return respondWithError(error, res);
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

                        response.headers['Content-Type'] = 'application/json';

                        res.writeHead(response.statusCode, response.headers);
                        res.end(json);

                        return;
                    }
                };
            }

            return cachedWebtaskAdapter(ctx, req, res);
        });
    };
}
