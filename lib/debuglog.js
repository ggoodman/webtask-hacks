'use strict';

const META_PROP_DEBUG = 'wt-debug';

module.exports = {
    create,
};

/**
 * Create a debug logging function
 *
 * @param {string} name Name of debug log
 * @param {object} meta Webtask metadata
 */
function create(name, meta) {
    /* eslint no-console:off */
    return (meta[META_PROP_DEBUG] || '')
        .split(',')
        .indexOf(name) >= 0
        ? console.log.bind(console)
        : () => undefined;
}
