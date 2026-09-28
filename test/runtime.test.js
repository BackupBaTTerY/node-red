'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pricesMetadata, requestOptions, summaryMetadata } = require('../lib/runtime');

const connection = {
    baseUrl: 'https://api.example.test',
    credentials: { apiKey: 'secret' },
};

test('requestOptions applies safe per-message summary overrides', () => {
    const options = requestOptions(
        'summary',
        { market: 'DE', hours: 48, windowHours: 4, currency: 'auto', priceMode: 'base', postalCode: '' },
        connection,
        { epf: { market: 'nl', hours: 72, windowHours: 2, currency: 'sek', priceMode: 'retail', postalCode: '1012' } },
    );

    assert.deepEqual(options, {
        apiKey: 'secret',
        baseUrl: 'https://api.example.test',
        market: 'NL',
        hours: 72,
        currency: 'SEK',
        priceMode: 'retail',
        postalCode: '1012',
        userAgent: '@backupbattery/node-red-energypriceforecast/0.2.0',
        windowHours: 2,
    });
});

test('requestOptions validates dynamic values', () => {
    assert.throws(
        () => requestOptions('summary', { market: 'DE' }, connection, { epf: { market: 'XX' } }),
        /Unsupported electricity market/,
    );
    assert.throws(
        () => requestOptions('summary', { market: 'DE' }, connection, { epf: { hours: 169 } }),
        /Hours must be a whole number from 1 to 168/,
    );
    assert.throws(
        () => requestOptions('prices', { market: 'DE' }, connection, { epf: { resolution: '5m' } }),
        /Resolution must be one of/,
    );
});

test('summaryMetadata exposes stable convenience fields without discarding zero and false', () => {
    const metadata = summaryMetadata({
        generated_at: '2026-09-28T10:00:00Z',
        country: 'DE',
        meta: { api_key_state: 'missing', allowed_horizon_hours: 48, used_horizon_hours: 24 },
        flat: {
            current_price: 0,
            current_price_unit: 'EUR/kWh',
            current_price_source: 'day_ahead',
            current_co2_g_kwh: 0,
            is_cheapest_window_now: false,
            combined_score_now: 0,
        },
    });

    assert.equal(metadata.currentPrice, 0);
    assert.equal(metadata.currentCo2GPerKwh, 0);
    assert.equal(metadata.isCheapestWindowNow, false);
    assert.equal(metadata.combinedScoreNow, 0);
    assert.equal(metadata.usedHorizonHours, 24);
});

test('summaryMetadata exposes complete window and quality blocks', () => {
    const quality = { available: true, hit_rate_percent: 75 };
    const metadata = summaryMetadata({
        flat: {
            cheapest_window_avg_price: 0.11,
            greenest_window_avg_co2_g_kwh: 123,
            greenest_window_remaining_minutes: 45,
            combined_window_start: '2026-09-28T10:00:00Z',
            combined_window_end: '2026-09-28T12:00:00Z',
            combined_window_score: 88,
        },
        forecast_quality: quality,
        hourly_accuracy: { available: true },
        cheaper_day_decision: { available: false },
        assumptions: { available: true },
    });

    assert.equal(metadata.cheapestWindowAveragePrice, 0.11);
    assert.equal(metadata.greenestWindowAverageCo2GPerKwh, 123);
    assert.equal(metadata.greenestWindowRemainingMinutes, 45);
    assert.equal(metadata.combinedWindowScore, 88);
    assert.equal(metadata.forecastQuality, quality);
    assert.deepEqual(metadata.assumptions, { available: true });
});

test('pricesMetadata describes the returned series', () => {
    const metadata = pricesMetadata({
        country: 'DK1',
        entries: [
            { start: '2026-09-28T10:00:00Z', end: '2026-09-28T10:15:00Z' },
            { start: '2026-09-28T10:15:00Z', end: '2026-09-28T10:30:00Z' },
        ],
        meta: { used_horizon_hours: 48 },
    });

    assert.equal(metadata.entryCount, 2);
    assert.equal(metadata.seriesStart, '2026-09-28T10:00:00Z');
    assert.equal(metadata.seriesEnd, '2026-09-28T10:30:00Z');
});
