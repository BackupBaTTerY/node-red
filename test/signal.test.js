'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluateSignal } = require('../lib/signal');

const now = Date.parse('2026-09-28T12:00:00Z');

function summary(flat = {}, generatedAt = '2026-09-28T11:30:00Z') {
    return {
        payload: {
            format: 'node-red-summary',
            generated_at: generatedAt,
            flat,
        },
    };
}

test('evaluates active window rules without changing the payload', () => {
    const msg = summary({
        is_cheapest_window_now: true,
        is_greenest_window_now: false,
        combined_window_start: '2026-09-28T11:00:00Z',
        combined_window_end: '2026-09-28T13:00:00Z',
    });

    assert.deepEqual(evaluateSignal('cheapest_window_active', undefined, msg, now), {
        active: true,
        value: true,
    });
    assert.equal(evaluateSignal('greenest_window_active', undefined, msg, now).active, false);
    assert.equal(evaluateSignal('combined_window_active', undefined, msg, now).active, true);
});

test('evaluates price, CO2 and score thresholds', () => {
    const msg = summary({ current_price: 0.08, current_co2_g_kwh: 180, combined_score_now: 82 });

    assert.equal(evaluateSignal('price_below', 0.10, msg, now).active, true);
    assert.equal(evaluateSignal('price_above', 0.30, msg, now).active, false);
    assert.equal(evaluateSignal('co2_below', 200, msg, now).active, true);
    assert.equal(evaluateSignal('co2_above', 500, msg, now).active, false);
    assert.equal(evaluateSignal('combined_score_at_least', 80, msg, now).active, true);
});

test('data-current rule compares generated time with a minute threshold', () => {
    assert.equal(evaluateSignal('data_current', 45, summary(), now).active, true);
    assert.equal(evaluateSignal('data_current', 15, summary(), now).active, false);
});

test('also accepts the convenience metadata emitted by the summary node', () => {
    const msg = {
        payload: {},
        energypriceforecast: {
            currentPrice: 0,
            currentCo2GPerKwh: 0,
            combinedScoreNow: 100,
            isCheapestWindowNow: false,
        },
    };

    assert.equal(evaluateSignal('price_below', 0.01, msg, now).active, true);
    assert.equal(evaluateSignal('cheapest_window_active', undefined, msg, now).active, false);
});

test('rejects incomplete input rather than inventing a false state', () => {
    assert.throws(
        () => evaluateSignal('co2_below', 200, { payload: {} }, now),
        /does not contain the data required/,
    );
    assert.throws(
        () => evaluateSignal('made_up', 0, summary(), now),
        /Unsupported Energy Price Forecast signal rule/,
    );
});
