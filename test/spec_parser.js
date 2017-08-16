'use strict';

const Assert = require('assert');
const Lab = require('lab');
const Util = require('../lib/util');

const lab = Lab.script();
const { describe, it } = lab;

module.exports = { lab };

describe('middleware spec parser', { parallel: true }, () => {
    it('correctly parses a basic module', done => {
        const spec = 'body-parser';
        const parsedSpec = Util.parseMiddlewareSpecString(spec);

        Assert.equal(parsedSpec.exportName, undefined);
        Assert.equal(parsedSpec.isFactoryFunction, false);
        Assert.equal(parsedSpec.moduleName, 'body-parser');

        done();
    });

    it('correctly parses a scoped module', done => {
        const spec = '@sencha/connect';
        const parsedSpec = Util.parseMiddlewareSpecString(spec);

        Assert.equal(parsedSpec.exportName, undefined);
        Assert.equal(parsedSpec.isFactoryFunction, false);
        Assert.equal(parsedSpec.moduleName, '@sencha/connect');

        done();
    });

    it('correctly parses a scoped module with an export', done => {
        const spec = '@sencha/connect/body-parser';
        const parsedSpec = Util.parseMiddlewareSpecString(spec);

        Assert.equal(parsedSpec.exportName, 'body-parser');
        Assert.equal(parsedSpec.isFactoryFunction, false);
        Assert.equal(parsedSpec.moduleName, '@sencha/connect');

        done();
    });

    it('correctly parses a scoped module with an exported factory function', done => {
        const spec = '@sencha/connect/body-parser()';
        const parsedSpec = Util.parseMiddlewareSpecString(spec);

        Assert.equal(parsedSpec.exportName, 'body-parser');
        Assert.equal(parsedSpec.isFactoryFunction, true);
        Assert.equal(parsedSpec.moduleName, '@sencha/connect');

        done();
    });

    it('throws for a bare scope', done => {
        const spec = '@sencha';

        Assert.throws(() => {
            Util.parseMiddlewareSpecString(spec);
        });

        done();
    });

    it('throws for a bare scope with factory function', done => {
        const spec = '@sencha/body-parser()';

        Assert.throws(() => {
            Util.parseMiddlewareSpecString(spec);
        });

        done();
    });

    it('throws for a bare factory function', done => {
        const spec = 'body-parser()';

        Assert.throws(() => {
            Util.parseMiddlewareSpecString(spec);
        });

        done();
    });
});

if (require.main === module) {
    Lab.report([lab], { output: process.stdout, progress: 2 });
}
