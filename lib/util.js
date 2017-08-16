'use strict';

const MIDDLEWARE_SPEC_RX = /^(@[^/(]+\/[^/(]+|[^@/(]+)(?:\/([^/(]+)(\(\))?)?$/;

module.exports = {
    parseMiddlewareSpecString,
    resolveCompiler,
};

function parseMiddlewareSpecString(spec) {
    const matches = spec.match(MIDDLEWARE_SPEC_RX);

    if (!matches) {
        throw new Error(`Failed to parse middleware spec: ${spec}`);
    }

    const moduleName = matches[1];
    const exportName = matches[2];
    const isFactoryFunction = !!matches[3];

    return { moduleName, exportName, isFactoryFunction };
}

function resolveCompiler(spec) {
    // Already a function, no resolution to do.
    if (typeof spec === 'function') return spec;

    const parsedSpec = parseMiddlewareSpecString(spec);
    const module = require(parsedSpec.moduleName);
    const moduleExport = parsedSpec.exportName
        ? module[parsedSpec.exportName]
        : module;

    return parsedSpec.isFactoryFunction ? moduleExport() : moduleExport;
}
