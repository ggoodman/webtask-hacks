module.exports = {
    extends: [
        "eslint:recommended",
    ],
    parserOptions: {
        ecmaVersion: 2015,
    },
    env: {
        node: true,
    },
    rules: {
       "indent": ["warn", 4],
       "global-require": 0,
       "camelcase": 0,
       "curly": 0,
       "no-undef": ["error"],
       "no-unused-vars": ["warn"],
       "semi": ["warn", "always"],
    }

};
