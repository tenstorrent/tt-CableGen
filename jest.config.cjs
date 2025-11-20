module.exports = {
    testEnvironment: 'jsdom',
    collectCoverageFrom: [
        'static/js/**/*.js',
        '!static/js/**/*.test.js',
        '!static/js/visualizer.js' // Exclude main file initially
    ],
    coverageThreshold: {
        global: {
            statements: 80,
            branches: 75,
            functions: 80,
            lines: 80
        }
    },
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    testMatch: ['**/tests/**/*.test.js'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    }
};

