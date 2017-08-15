'use strict';

module.exports = {
    middleware,
};

function middleware(ctx, req, res, next) {
    // Cron authentication relies on the caller knowing the webtask
    // token that is associated with the cron job and passing that
    // token as a bearer token in the authorization header.
    const match = (ctx.headers['authorization'] || '')
        .trim()
        .match(/^bearer (.+)$/i);

    if (!match || !match[1] || !ctx.token || ctx.token !== match[1]) {
        const error = new Error('Unauthorized extensibility point');
        error.statusCode = 403;

        return next(error);
    }

    return next();
}
