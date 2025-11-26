module.exports = {
    testEnvironment: 'jsdom',
    collectCoverageFrom: [
        'static/js/**/*.js',
        '!static/js/**/*.test.js',
        '!static/js/visualizer.js' // Exclude main file initially
    ],
    coverageThreshold: {
        // Note: Thresholds are set low because integration tests focus on specific flows
        // These can be increased as more unit tests are added
        global: {
            statements: 5,   // Very low threshold - integration tests don't cover all code paths
            branches: 2,
            functions: 5,
            lines: 5
        }
    },
    coverageReporters: [
        'text',           // Console output
        'text-summary',  // Summary at end
        'html',          // HTML report in coverage/
        'lcov'           // LCOV format for CI/CD tools
    ],
    coverageDirectory: 'coverage',
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    testMatch: ['**/tests/**/*.test.js'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    }
};

