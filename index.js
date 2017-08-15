'use strict';

Object.defineProperty(module.exports, 'authenticate', {
    get() {
        return require('./middleware/authenticate').middleware;
    }
});

Object.defineProperty(module.exports, 'authenticateCron', {
    get() {
        return require('./middleware/authenticate_cron').middleware;
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
