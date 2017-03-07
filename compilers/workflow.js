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

const compoundWebtaskCompilers = {
    fanout: compileFanout,
    sequence: compileSequence,
};
const workflowNodeSchema = Joi.object({
    name: Joi.string()
        .description('The name of the webtask to be invoked')
        .required(),
});
const workflowSchema = Joi.object()
    .description('A webtask workflow')
    .keys({
        type: Joi.string()
            .description('The type of workflow that this represents')
            .allow(Object.keys(compoundWebtaskCompilers))
            .required(),
        nodes: Joi.array()
            .description('The set of nodes that comprise the workflow')
            .items(workflowNodeSchema).required(),
    });


exports.workflow = workflowCompiler;


/**
 * Compile a webtask definition, producing a webtask function that executes the workflow
 *
 * @param {options} options
 * @param {function} cb callback having the form `function(error, webtaskFunction)`
 */
function workflowCompiler(options, cb) {
    return Async.waterfall([
        (next) => compileScript(options.script, options.nodejsCompiler, next),
        (schema, next) => validateSchema(schema, next),
        (schema, next) => createCompiler(schema, next),
    ], cb);
}


/**
 * Compile the provided script to produce an workflow definition object
 *
 * @param {string|object} script
 * @param {function} nodejsCompiler
 * @param {function} cb
 */
function compileScript(script, nodejsCompiler, cb) {
    if (!script) {
        const error = new Error('Invalid compound webtask: empty code');

        return void cb(error);
    }

    if (typeof script === 'object') {
        return void cb(null, script);
    }

    try {
        const schema = JSON.parse(script);

        return void cb(null, schema);
    } catch (e) {
        // If JSON parsing fails, try with Node
        return void nodejsCompiler(script, (error, schema) => {
            if (error) {
                const error = new Error(`Invalid compound webtask: error compiling sequence code: ${error.message}`);

                return void cb(error);
            }

            return void cb(null, schema);
        });
    }
}

function validateSchema(schema, cb) {
    return void Joi.validate(schema, workflowSchema, (error, schema) => {
        if (error) {
            console.log('Invalid webtask workflow:', error.message);

            error = Boom.wrap(error, 500, 'Invalid sequence');

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
        const wreck = createWreck(req, sequence);

        return void Async.map(sequence.nodes, (node, next) => {
            const method = node.method || req.method;
            const payload = req;
            const query = Object.assign({}, req.query, node.query);
            const qs = Querystring.stringify(query);
            const uri = `/${node.name}?${qs}`;

            return void wreck.request(method, uri, { headers, payload }, next);
        }, (error, responses) => {
            if (error) {
                res.writeHead(error.output.statusCode, Object.assign({
                    'Content-Type': 'application/json',
                }, error.output.headers));
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
            const result = responses.reduce((result, response) => {
                if (response.statusCode !== 200) {
                    result.statusCode = 502;
                }

                result.payload.push({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage,
                    headers: response.headers,
                });

                return result;
            }, resultSeed);

            res.writeHead(result.statusCode, result.headers);
            res.end(JSON.stringify(result.payload));

            return;
        });
    };
}

function compileSequence(sequence) {
    return function webtaskSequence(ctx, req, res) {
        const wreck = createWreck(req, sequence);

        return void Async.reduce(sequence.nodes, req, (payload, node, next) => {
            const headers = getNormalizedHeaders(payload);
            const method = node.method || req.method;
            const query = Object.assign({}, req.query, node.query);
            const qs = Querystring.stringify(query);
            const uri = `/${node.name}?${qs}`;

            return void wreck.request(method, uri, { headers, payload }, (error, response) => {
                if (!error && response.statusCode >= 400) {
                    error = Boom.create(response.statusCode, `Unexpected status code: ${response.statusCode}`);
                }

                if (!error && response.statusCode !== 200) {
                    error = Boom.badImplementation(`Unexpected status code: ${response.statusCode}`);
                }

                if (error) {
                    return void next(error);
                }

                return void next(null, response);
            });
        }, (error, result) => {
            if (error) {
                res.writeHead(error.output.statusCode, Object.assign({
                    'Content-Type': 'application/json',
                }, error.output.headers));
                res.end(JSON.stringify(error.output.payload));

                return;
            }

            res.writeHead(result.statusCode, result.headers);
            result.pipe(res);

            return;
        });
    };
}

function createWreck(req, schema) {
    const proto = req.headers['x-forwarded-proto']
        ?   req.headers['x-forwarded-proto']
        :   'https';
    const baseUrl =
        req.x_wt.url_format === USE_CUSTOM_DOMAIN ? `${proto}://${req.headers.host}/${req.x_wt.container}/` :
        req.x_wt.url_format === USE_SHARED_DOMAIN ? `${proto}://${req.headers.host}/api/run/${req.x_wt.container}/` :
        req.x_wt.url_format === USE_WILDCARD_DOMAIN ? `${proto}://${req.headers.host}/` :
        null;

    if (!baseUrl) {
        throw new Error(`Unexpected url format: ${req.x_wt.url_format}`);
    }

    return Wreck.defaults({
        baseUrl,
        headers: {
            'Connection': 'keep-alive',
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
