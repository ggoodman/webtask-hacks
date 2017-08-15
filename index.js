'use strict';

Object.defineProperty(module.exports, 'authenticate', {
    get() {
        return require('./middleware/authenticate').compiler;
    }
});

Object.defineProperty(module.exports, 'middleware', {
    get() {
        return require('./compilers/middleware').compiler;
    }
});

Object.defineProperty(module.exports, 'workflow', {
    get() {
        return require('./compilers/workflow').compiler;
    }
});
