'use strict';

const Async = require('async');
const Boom = require('boom');
const Joi = require('joi');
const Querystring = require('querystring');
const Wreck = require('wreck');

const DEFAULT_TIMEOUT = 10000;
const USE_WILDCARD_DOMAIN = 3;
const USE_CUSTOM_DOMAIN = 2;
const USE_SHARED_DOMAIN = 1;

module.exports = {
    compiler,
};

/**
 * Compile a webtask definition, producing a webtask function that executes the workflow
 *
 * @param {options} options
 * @param {function} cb callback having the form `function(error, webtaskFunction)`
 */
function compiler(options, cb) {
    const LOG_LEVEL = options.meta['wt-workflow-debug']
        ? +options.meta['wt-workflow-debug']
        : 40;

    const compoundWebtaskCompilers = {
        fanout: compileFanout,
        sequence: compileSequence,
    };
    const logger = {
        debug: createLogFunction('WORKFLOW:', 20, 'debug'),
        info: createLogFunction('WORKFLOW:', 30, 'info'),
        error: createLogFunction('WORKFLOW:', 50, 'error'),
        warn: createLogFunction('WORKFLOW:', 40, 'warn'),
    };
    const workflowNodeSchema = Joi.object({
        name: Joi.string()
            .description('The name of the webtask to be invoked')
            .required(),
    });
    const workflowSchema = Joi.object().description('A webtask workflow').keys({
        type: Joi.string()
            .description('The type of workflow that this represents')
            .allow(Object.keys(compoundWebtaskCompilers))
            .required(),
        nodes: Joi.array()
            .description('The set of nodes that comprise the workflow')
            .items(workflowNodeSchema)
            .required(),
    });

    return Async.waterfall(
        [
            next => compileScript(options.script, options.nodejsCompiler, next),
            (schema, next) => validateSchema(schema, next),
            (schema, next) => createCompiler(schema, next),
        ],
        cb
    );

    /**
     * Compile the provided script to produce an workflow definition object
     *
     * @param {string|object} script
     * @param {function} nodejsCompiler
     * @param {function} cb
     */
    function compileScript(script, nodejsCompiler, cb) {
        if (!script) {
            const error = new Error(
                'Invalid webtask workflow: the webtask cannot be empty'
            );

            logger.error(error.message);

            return void cb(error);
        }

        if (typeof script === 'object') {
            return void cb(null, script);
        }

        try {
            const schema = JSON.parse(script);

            return void cb(null, schema);
        } catch (e) {
            logger.debug(
                'Webtask code could not be parsed as JSON; attempting to compile as JavaScript'
            );

            // If JSON parsing fails, try with Node
            return void nodejsCompiler(script, (error, schema) => {
                if (error) {
                    const error = new Error(
                        `Invalid compound webtask: error compiling sequence code: ${error.message}`
                    );

                    logger.error(error.message);

                    return void cb(error);
                }

                return void cb(null, schema);
            });
        }
    }

    function createLogFunction(prefix, level, levelName) {
        if (level < LOG_LEVEL) return function() {};

        return function() {
            /* eslint no-console:off */
            const args = [prefix, `[${levelName.toUpperCase()}]`];

            args.push.apply(args, arguments);

            return void console.log.apply(console, args);
        };
    }

    function validateSchema(schema, cb) {
        return void Joi.validate(schema, workflowSchema, (error, schema) => {
            if (error) {
                error = Boom.wrap(
                    error,
                    500,
                    `Invalid webtask workflow: ${error.message}`
                );

                logger.error(error.message);

                return void cb(error);
            }

            return void cb(null, schema);
        });
    }

    /**
     * Validate a workflow schema and produce a webtask function that will execute the workflow
     *
     * @param {object} schema workflow definition object
     * @param {function} cb callback with the form `function(error, webtaskFunction)`
     */
    function createCompiler(schema, cb) {
        // Since the schema has already been validated, we know that the 'schema.type' is valid
        const compiler = compoundWebtaskCompilers[schema.type];
        const webtaskFn = compiler(schema);

        return void cb(null, webtaskFn);
    }

    function compileFanout(sequence) {
        return function webtaskFanout(ctx, req, res) {
            const headers = getNormalizedHeaders(req);
            const start = Date.now();
            const wreck = createWreck(req, sequence);

            logger.info(`Executing fanout workflow`);

            return void Async.map(
                sequence.nodes,
                (node, next) => {
                    const method = node.method || req.method;
                    const payload = req;
                    const query = Object.assign({}, req.query, node.query);
                    const qs = Querystring.stringify(query);
                    const start = Date.now();
                    const uri = `/${node.name}?${qs}`;

                    logger.debug(`Invoking the fanout node '${node.name}'`);

                    return void wreck.request(
                        method,
                        uri,
                        { headers, payload },
                        (error, response) => {
                            const latency = Date.now() - start;

                            if (error) {
                                logger.warn(
                                    `Error while running the node '${node.name}': ${error.message}`
                                );

                                return void next(error);
                            }

                            logger.debug(
                                `Completed invocation of the fanout node '${node.name}' in ${latency}ms with status code: ${response.statusCode}`
                            );

                            return void next(null, response);
                        }
                    );
                },
                (error, responses) => {
                    const latency = Date.now() - start;

                    if (error) {
                        logger.warn(
                            `Completed fanout workflow in ${latency}ms with status code: ${error
                                .output.statusCode}`
                        );

                        res.writeHead(
                            error.output.statusCode,
                            Object.assign(
                                {
                                    'Content-Type': 'application/json',
                                },
                                error.output.headers
                            )
                        );
                        res.end(JSON.stringify(error.output.payload));

                        return;
                    }

                    const resultSeed = {
                        headers: {
                            'Content-type': 'application/json',
                        },
                        payload: [],
                        statusCode: 200,
                    };
                    const result = responses.reduce((result, response, idx) => {
                        if (response.statusCode !== 200) {
                            const node = sequence.nodes[idx];

                            logger.warn(
                                `The fanout node '${node.name}' responded with a non-200 status code of ${response.statusCode} so the entire workflow will respond with a 502 status code`
                            );

                            result.statusCode = 502;
                        }

                        result.payload.push({
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers,
                        });

                        return result;
                    }, resultSeed);

                    logger.info(
                        `Completed fanout workflow in ${latency}s with status code: ${result.statusCode}`
                    );

                    res.writeHead(result.statusCode, result.headers);
                    res.end(JSON.stringify(result.payload));

                    return;
                }
            );
        };
    }

    function compileSequence(sequence) {
        return function webtaskSequence(ctx, req, res) {
            const start = Date.now();
            const wreck = createWreck(req, sequence);

            logger.info(`Executing sequence workflow`);

            return void Async.reduce(
                sequence.nodes,
                req,
                (payload, node, next) => {
                    const headers = getNormalizedHeaders(payload);
                    const method = node.method || req.method;
                    const query = Object.assign({}, req.query, node.query);
                    const qs = Querystring.stringify(query);
                    const start = Date.now();
                    const uri = `/${node.name}?${qs}`;

                    logger.debug(`Invoking the sequence node '${node.name}'`);

                    return void wreck.request(
                        method,
                        uri,
                        { headers, payload },
                        (error, response) => {
                            const latency = Date.now() - start;

                            if (error) {
                                logger.warn(
                                    `Error while running the workflow sequence node '${node.name}': ${error.message}`
                                );
                            }

                            if (!error && response.statusCode >= 400) {
                                logger.warn(
                                    `Request to workflow sequence node '${node.name} responded with an unexpected 4xx or 5xx status code '${response.statusCode}'`
                                );

                                error = Boom.create(
                                    response.statusCode,
                                    `Unexpected status code: ${response.statusCode}`
                                );
                            }

                            if (!error && response.statusCode !== 200) {
                                logger.warn(
                                    `Request to workflow sequence node '${node.name} responded with an unexpected non-200 status code '${response.statusCode}'`
                                );

                                error = Boom.badImplementation(
                                    `Unexpected status code: ${response.statusCode}`
                                );
                            }

                            if (error) {
                                logger.warn(
                                    `Aborting the workflow sequence because of errors running the node '${node.name}'`
                                );

                                return void next(error);
                            }

                            logger.debug(
                                `Completed invocation of the sequence node '${node.name}' in ${latency}ms with status code: ${response.statusCode}`
                            );

                            return void next(null, response);
                        }
                    );
                },
                (error, result) => {
                    const latency = Date.now() - start;

                    if (error) {
                        logger.warn(
                            `Completed sequence workflow in ${latency}ms with status code: ${error
                                .output.statusCode}`
                        );

                        res.writeHead(
                            error.output.statusCode,
                            Object.assign(
                                {
                                    'Content-Type': 'application/json',
                                },
                                error.output.headers
                            )
                        );
                        res.end(JSON.stringify(error.output.payload));

                        return;
                    }

                    logger.info(
                        `Completed sequence workflow in ${latency}s with status code: ${result.statusCode}`
                    );

                    res.writeHead(result.statusCode, result.headers);
                    result.pipe(res);

                    return;
                }
            );
        };
    }

    function createWreck(req, schema) {
        const proto = req.headers['x-forwarded-proto']
            ? req.headers['x-forwarded-proto']
            : 'https';
        const baseUrl =
            req.x_wt.url_format === USE_CUSTOM_DOMAIN
                ? `${proto}://${req.headers.host}/${req.x_wt.container}/`
                : req.x_wt.url_format === USE_SHARED_DOMAIN
                  ? `${proto}://${req.headers.host}/api/run/${req.x_wt
                        .container}/`
                  : req.x_wt.url_format === USE_WILDCARD_DOMAIN
                    ? `${proto}://${req.headers.host}/`
                    : null;

        if (!baseUrl) {
            throw new Error(`Unexpected url format: ${req.x_wt.url_format}`);
        }

        return Wreck.defaults({
            baseUrl,
            headers: {
                Connection: 'keep-alive',
            },
            timeout: schema.timeout || DEFAULT_TIMEOUT,
        });
    }

    function getNormalizedHeaders(stream) {
        const headers = Object.assign({}, stream.headers);

        delete headers['accept-version'];
        delete headers['connection'];
        delete headers['content-length'];
        delete headers['host'];
        delete headers['x-forwarded-for'];
        delete headers['x-forwarded-port'];
        delete headers['x-forwarded-proto'];
        delete headers['x-wt-params'];

        return headers;
    }
}
