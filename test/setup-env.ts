// Loaded by jest before any e2e suite imports the application.
//
// The suites fire dozens of requests per second from one address; with the
// production limits (10 req/s) they would be answered with 429 long before
// they reach the code under test. Explicit values in the environment win.
process.env.NODE_ENV ??= 'test';
process.env.THROTTLE_SHORT_LIMIT ??= '10000';
process.env.THROTTLE_LONG_LIMIT ??= '100000';
