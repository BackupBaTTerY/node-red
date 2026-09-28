'use strict';

const assert = require('node:assert/strict');
const { fetchPrices, fetchSummary } = require('../lib/client');

async function main() {
    const common = {
        market: 'DE',
        hours: 24,
        currency: 'SEK',
        priceMode: 'base',
        userAgent: '@backupbattery/node-red-energypriceforecast-live-smoke/0.2.0',
    };
    const [summary, prices] = await Promise.all([
        fetchSummary({ ...common, windowHours: 4 }),
        fetchPrices({ ...common, mode: 'mixed', resolution: '15m' }),
    ]);

    assert.equal(summary.format, 'node-red-summary');
    assert.equal(summary.integration, 'node_red');
    assert.ok(summary.flat && typeof summary.flat === 'object');
    assert.equal(summary.flat.current_price_unit, 'SEK/kWh');
    assert.equal(prices.format, 'node-red-prices');
    assert.equal(prices.country, 'DE');
    assert.equal(prices.currency, 'SEK');
    assert.ok(Array.isArray(prices.entries) && prices.entries.length > 0);
    process.stdout.write(`Live API OK: summary ${summary.country}, prices ${prices.entries.length} entries\n`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
