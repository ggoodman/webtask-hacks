'use strict';

const Console = require('console');
const Continuation = require('continuation-local-storage');
const Stream = require('stream');

module.exports = {
    installCustomLogger,
    middleware,
};

function installCustomLogger() {
    // Prevent re-initialization
    if (/* eslint no-console:off */ console.$ns) return console.$ns;

    const ns = Continuation.createNamespace('logger');
    const stderr = new Stream.Transform({
        transform(chunk, encoding, cb) {
            cb(
                null,
                JSON.stringify({
                    chunk: chunk.slice(0, chunk.length - 1).toString('utf-8'),
                    requestId: ns.get('requestId'),
                    webtaskId: ns.get('webtaskId'),
                }) + '\n'
            );
        },
    });
    const stdout = new Stream.Transform({
        transform(chunk, encoding, cb) {
            cb(
                null,
                JSON.stringify({
                    chunk: chunk.slice(0, chunk.length - 1).toString('utf-8'),
                    requestId: ns.get('requestId'),
                    webtaskId: ns.get('webtaskId'),
                }) + '\n'
            );
        },
    });

    const customConsole = new Console.Console(stdout, stderr);

    // Attach the CLS namespace to the custom console instance
    // so that we can prevent this from being re-initialized
    customConsole.$ns = ns;

    Object.defineProperty(global, 'console', {
        enumerable: true,
        get: () => customConsole,
    });

    stderr.pipe(process.stderr);
    stdout.pipe(process.stdout);

    return ns;
}

function middleware(ctx, req, res, next) {
    const ns = installCustomLogger();

    return ns.run(() => {
        ns.set('requestId', req.x_wt.req_id);
        ns.set('webtaskId', req.x_wt.jtn);

        return next();
    });
}
