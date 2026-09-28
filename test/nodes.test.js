'use strict';

const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/config');
const plannerNode = require('../nodes/planner');
const pricesNode = require('../nodes/prices');
const signalNode = require('../nodes/signal');
const summaryNode = require('../nodes/summary');

const originalFetch = global.fetch;
const originalDateNow = Date.now;

function load(nodes, flow, credentials = {}) {
    return new Promise((resolve, reject) => {
        helper.load(nodes, flow, credentials, (error) => error ? reject(error) : resolve());
    });
}

function waitForInput(node) {
    return new Promise((resolve) => node.once('input', resolve));
}

before(() => new Promise((resolve) => helper.startServer(resolve)));

afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
    return helper.unload();
});

after(() => new Promise((resolve) => helper.stopServer(resolve)));

test('summary node sends the full response and convenience metadata', async () => {
    let request;
    global.fetch = async (url, options) => {
        request = { url: new URL(url), options };
        return new Response(JSON.stringify({
            format: 'node-red-summary',
            generated_at: '2026-09-28T10:00:00Z',
            country: 'DE',
            flat: {
                current_price: 0.123,
                current_price_unit: 'EUR/kWh',
                current_price_source: 'day_ahead',
                current_co2_g_kwh: 250,
                is_cheapest_window_now: true,
            },
            meta: { api_key_state: 'valid', used_horizon_hours: 72, allowed_horizon_hours: 120 },
        }), { status: 200 });
    };

    await load([configNode, summaryNode], [
        { id: 'cfg', type: 'energypriceforecast-config', baseUrl: 'https://example.test' },
        {
            id: 'summary', type: 'energypriceforecast-summary', connection: 'cfg', market: 'DE',
            hours: 48, windowHours: 4, priceMode: 'base', postalCode: '', wires: [['out']],
        },
        { id: 'out', type: 'helper' },
    ], { cfg: { apiKey: 'secret-key' } });

    const output = helper.getNode('out');
    const received = waitForInput(output);
    helper.getNode('summary').receive({ epf: { hours: 72 } });
    const msg = await received;

    assert.equal(msg.payload.country, 'DE');
    assert.equal(msg.energypriceforecast.currentPrice, 0.123);
    assert.equal(msg.energypriceforecast.isCheapestWindowNow, true);
    assert.equal(msg.topic, 'energypriceforecast/de/summary');
    assert.equal(request.url.searchParams.get('hours'), '72');
    assert.equal(request.options.headers.Authorization, 'Bearer secret-key');
});

test('prices node returns no message after an HTTP error', async () => {
    global.fetch = async () => new Response(JSON.stringify({ detail: 'Temporary failure' }), { status: 503 });

    await load([configNode, pricesNode], [
        { id: 'cfg', type: 'energypriceforecast-config', baseUrl: 'https://example.test' },
        {
            id: 'prices', type: 'energypriceforecast-prices', connection: 'cfg', market: 'DE',
            hours: 48, mode: 'mixed', resolution: '15m', priceMode: 'base', postalCode: '', wires: [['out']],
        },
        { id: 'out', type: 'helper' },
    ]);

    let successCount = 0;
    helper.getNode('out').on('input', () => successCount += 1);
    const prices = helper.getNode('prices');
    const errorReceived = new Promise((resolve) => prices.once('call:error', resolve));
    prices.receive({});
    const call = await errorReceived;

    assert.match(call.args[0].message, /HTTP 503: Temporary failure/);
    assert.equal(successCount, 0);
});

test('signal node routes true and false states to separate outputs', async () => {
    await load(signalNode, [
        {
            id: 'signal', type: 'energypriceforecast-signal', rule: 'price_below',
            threshold: 0.10, emitMode: 'every', wires: [['yes'], ['no']],
        },
        { id: 'yes', type: 'helper' },
        { id: 'no', type: 'helper' },
    ]);

    const yes = helper.getNode('yes');
    const no = helper.getNode('no');
    const active = waitForInput(yes);
    helper.getNode('signal').receive({ payload: { flat: { current_price: 0.05 } } });
    const activeMessage = await active;
    assert.equal(activeMessage.energypriceforecast.signal.active, true);
    assert.equal(activeMessage.energypriceforecast.signal.threshold, 0.10);

    const inactive = waitForInput(no);
    helper.getNode('signal').receive({ payload: { flat: { current_price: 0.25 } } });
    const inactiveMessage = await inactive;
    assert.equal(inactiveMessage.energypriceforecast.signal.active, false);
    assert.equal(inactiveMessage.energypriceforecast.signal.changed, true);
});

test('planner node keeps the first complete plan locked across later updates', async () => {
    const start = Date.parse('2026-09-28T00:00:00Z');
    Date.now = () => start + 30 * 60_000;
    const entries = (prices) => prices.flatMap((value, hour) => [0, 1, 2, 3].map((quarter) => ({
        start: new Date(start + hour * 3_600_000 + quarter * 900_000).toISOString(),
        end: new Date(start + hour * 3_600_000 + (quarter + 1) * 900_000).toISOString(),
        value,
        source: 'forecast',
    })));

    await load(plannerNode, [
        {
            id: 'planner', type: 'energypriceforecast-planner', planType: 'repeating',
            selectedHours: 1, blockHours: 4, startDay: 1, startHour: 0,
            timeZone: 'UTC', emitMode: 'every', wires: [['yes'], ['no']],
        },
        { id: 'yes', type: 'helper' },
        { id: 'no', type: 'helper' },
    ]);

    const yes = helper.getNode('yes');
    const first = waitForInput(yes);
    helper.getNode('planner').receive({ payload: { country: 'DE', entries: entries([0.05, 0.10, 0.20, 0.30]) } });
    const firstMessage = await first;
    assert.equal(firstMessage.energypriceforecast.plan.active, true);
    assert.equal(firstMessage.energypriceforecast.plan.hours[0].averageValue, 0.05);

    const second = waitForInput(yes);
    helper.getNode('planner').receive({ payload: { country: 'DE', entries: entries([0.90, 0.01, 0.20, 0.30]) } });
    const secondMessage = await second;
    assert.equal(secondMessage.energypriceforecast.plan.active, true);
    assert.equal(secondMessage.energypriceforecast.plan.hours[0].averageValue, 0.05);
});
