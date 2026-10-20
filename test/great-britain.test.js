'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { requestOptions, summaryMetadata } = require('../lib/runtime');
const { timeZoneForMarket, weeklyWindow } = require('../lib/planner');

test('GB is accepted by both nodes with automatic or explicit pounds', () => {
    for (const kind of ['summary', 'prices']) {
        for (const currency of ['auto', 'GBP', 'EUR']) {
            const options = requestOptions(kind, { market: 'GB', currency }, {}, {});
            assert.equal(options.market, 'GB');
            assert.equal(options.currency, currency);
        }
        const editor = readFileSync(require.resolve(`../nodes/${kind}.html`), 'utf8');
        assert.match(editor, /value="GB"/);
        assert.match(editor, /value="GBP"/);
    }
});

test('British negative and zero prices retain pounds rather than being scaled as pence', () => {
    for (const current_price of [0, -0.02, 0.179062]) {
        const metadata = summaryMetadata({ country: 'GB', flat: { current_price, current_price_unit: 'GBP/kWh' } });
        assert.equal(metadata.currentPrice, current_price);
        assert.equal(metadata.currentPriceUnit, 'GBP/kWh');
    }
});

test('British weekend plans use London and respect the October clock change', () => {
    const zone = timeZoneForMarket('GB');
    assert.equal(zone, 'Europe/London');
    const window = weeklyWindow(zone, 6, 0, 1, 0, Date.parse('2026-10-24T10:00:00Z'));
    assert.equal(new Date(window.startMs).toISOString(), '2026-10-23T23:00:00.000Z');
    assert.equal(new Date(window.endMs).toISOString(), '2026-10-26T00:00:00.000Z');
    assert.equal((window.endMs - window.startMs) / 3600000, 49);
});
