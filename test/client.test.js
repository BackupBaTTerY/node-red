'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const {
    ApiError,
    fetchPrices,
    fetchSummary,
    normalizeBaseUrl,
} = require('../lib/client');

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

test('fetchSummary builds the Node-RED URL and keeps the key in the Authorization header', async () => {
    let request;
    global.fetch = async (url, options) => {
        request = { url: new URL(url), options };
        return new Response(JSON.stringify({ format: 'node-red-summary', meta: { api_key_state: 'valid' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    const result = await fetchSummary({
        baseUrl: 'https://example.test/',
        apiKey: 'top-secret',
        userAgent: 'test/1.0.0',
        market: 'DE',
        hours: 72,
        windowHours: 3,
        priceMode: 'retail',
        postalCode: '10115',
    });

    assert.equal(request.url.origin + request.url.pathname, 'https://example.test/api/v1/node-red/summary');
    assert.equal(request.url.searchParams.get('country'), 'de');
    assert.equal(request.url.searchParams.get('hours'), '72');
    assert.equal(request.url.searchParams.get('summary_hours'), '72');
    assert.equal(request.url.searchParams.get('window_hours'), '3');
    assert.equal(request.url.searchParams.get('price_mode'), 'retail');
    assert.equal(request.url.searchParams.get('plz'), '10115');
    assert.equal(request.url.searchParams.has('apiKey'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer top-secret');
    assert.equal(result.format, 'node-red-summary');
});

test('fetchPrices omits retail fields in base mode', async () => {
    let requestUrl;
    global.fetch = async (url) => {
        requestUrl = new URL(url);
        return new Response(JSON.stringify({ format: 'node-red-prices', entries: [] }), { status: 200 });
    };

    await fetchPrices({
        market: 'NO2',
        hours: 48,
        mode: 'mixed',
        resolution: '15m',
        priceMode: 'base',
    });

    assert.equal(requestUrl.pathname, '/api/v1/node-red/prices');
    assert.equal(requestUrl.searchParams.get('country'), 'no2');
    assert.equal(requestUrl.searchParams.get('mode'), 'mixed');
    assert.equal(requestUrl.searchParams.get('resolution'), '15m');
    assert.equal(requestUrl.searchParams.has('price_mode'), false);
    assert.equal(requestUrl.searchParams.has('plz'), false);
});

test('HTTP errors keep the server detail', async () => {
    global.fetch = async () => new Response(JSON.stringify({ detail: 'Unsupported market XX.' }), { status: 400 });

    await assert.rejects(
        fetchPrices({
            market: 'XX',
            hours: 48,
            mode: 'mixed',
            resolution: '15m',
            priceMode: 'base',
        }),
        (error) => {
            assert.ok(error instanceof ApiError);
            assert.equal(error.status, 400);
            assert.equal(error.detail, 'Unsupported market XX.');
            assert.match(error.message, /HTTP 400: Unsupported market XX/);
            return true;
        },
    );
});

test('invalid JSON produces a useful API error', async () => {
    global.fetch = async () => new Response('<html>wrong route</html>', { status: 404 });

    await assert.rejects(
        fetchSummary({ market: 'DE', hours: 48, windowHours: 4, priceMode: 'base' }),
        (error) => error instanceof ApiError && error.status === 404 && error.code === 'invalid_json',
    );
});

test('an unexpected JSON response is rejected instead of being emitted as forecast data', async () => {
    global.fetch = async () => new Response(JSON.stringify({ format: 'some-other-api', entries: [] }), { status: 200 });

    await assert.rejects(
        fetchPrices({ market: 'DE', hours: 48, mode: 'mixed', resolution: '15m', priceMode: 'base' }),
        (error) => error instanceof ApiError && error.code === 'invalid_response',
    );
});

test('normalizeBaseUrl rejects non-HTTP protocols', () => {
    assert.equal(normalizeBaseUrl('https://example.test///'), 'https://example.test');
    assert.equal(normalizeBaseUrl('http://localhost:5001/'), 'http://localhost:5001');
    assert.throws(() => normalizeBaseUrl('http://example.test'), /must use HTTPS/);
    assert.throws(() => normalizeBaseUrl('file:///tmp/api'), /must use HTTPS/);
    assert.throws(() => normalizeBaseUrl('not a URL'), /invalid/);
});
