'use strict';

const Decompress = require('decompress');

exports.middleware = () => (req, res, next) => {
    const webtaskContext = req.webtaskContext;
    const code = Buffer.from(webtaskContext.compiler.script, 'base64');
    const path = `/tmp/${Math.random()
        .toString(36)
        .slice(2, 7)}`;

    return Decompress(code, path).then(() => {
        webtaskContext.compiler.script = `module.exports = require('${path}');`;

        return next();
    }, next);
};
