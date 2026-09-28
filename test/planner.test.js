'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    createPlan,
    findCheapestHours,
    fixedRepeatingWindow,
    planState,
    timeZoneForMarket,
    weeklyWindow,
} = require('../lib/planner');

function quarterHourEntries(startMs, prices, source = 'day_ahead') {
    const entries = [];
    prices.forEach((price, hour) => {
        for (let quarter = 0; quarter < 4; quarter += 1) {
            const slotStart = startMs + hour * 3_600_000 + quarter * 900_000;
            entries.push({
                start: new Date(slotStart).toISOString(),
                end: new Date(slotStart + 900_000).toISOString(),
                value: price,
                source,
            });
        }
    });
    return entries;
}

test('market time zones are inferred and explicit IANA zones are validated', () => {
    assert.equal(timeZoneForMarket('DE'), 'Europe/Berlin');
    assert.equal(timeZoneForMarket('no4'), 'Europe/Oslo');
    assert.equal(timeZoneForMarket('DE', 'Europe/London'), 'Europe/London');
    assert.throws(() => timeZoneForMarket('XX'), /No time zone is known/);
    assert.throws(() => timeZoneForMarket('DE', 'Somewhere/Invalid'), /Invalid IANA time zone/);
});

test('daily local blocks remain tied to midnight across spring DST', () => {
    const window = fixedRepeatingWindow(
        'Europe/Berlin', 1, 0, 24, Date.parse('2026-03-29T10:00:00Z'),
    );

    assert.equal(new Date(window.startMs).toISOString(), '2026-03-28T23:00:00.000Z');
    assert.equal(new Date(window.endMs).toISOString(), '2026-03-29T22:00:00.000Z');
    assert.equal((window.endMs - window.startMs) / 3_600_000, 23);
});

test('daily local blocks include the repeated hour across autumn DST', () => {
    const window = fixedRepeatingWindow(
        'Europe/Berlin', 1, 0, 24, Date.parse('2026-10-25T12:00:00Z'),
    );

    assert.equal(new Date(window.startMs).toISOString(), '2026-10-24T22:00:00.000Z');
    assert.equal(new Date(window.endMs).toISOString(), '2026-10-25T23:00:00.000Z');
    assert.equal((window.endMs - window.startMs) / 3_600_000, 25);
});

test('weekend window returns the current or upcoming Saturday-to-Monday block', () => {
    const before = weeklyWindow('Europe/Berlin', 6, 0, 1, 0, Date.parse('2026-08-12T10:00:00Z'));
    assert.equal(new Date(before.startMs).toISOString(), '2026-08-14T22:00:00.000Z');
    assert.equal(new Date(before.endMs).toISOString(), '2026-08-16T22:00:00.000Z');

    const during = weeklyWindow('Europe/Berlin', 6, 0, 1, 0, Date.parse('2026-08-15T10:00:00Z'));
    assert.equal(during.key, before.key);
});

test('weekend boundaries also follow local time across autumn DST', () => {
    const window = weeklyWindow(
        'Europe/Berlin', 6, 0, 1, 0, Date.parse('2026-10-24T10:00:00Z'),
    );

    assert.equal(new Date(window.startMs).toISOString(), '2026-10-23T22:00:00.000Z');
    assert.equal(new Date(window.endMs).toISOString(), '2026-10-25T23:00:00.000Z');
    assert.equal((window.endMs - window.startMs) / 3_600_000, 49);
});

test('selects the cheapest individual hours only with complete coverage', () => {
    const start = Date.parse('2026-09-28T00:00:00Z');
    const entries = quarterHourEntries(start, [0.30, 0.10, 0.50, 0.05]);
    const selected = findCheapestHours(entries, 2, start, start + 4 * 3_600_000);

    assert.deepEqual(selected.map((hour) => hour.averageValue), [0.10, 0.05]);
    assert.equal(findCheapestHours(entries.slice(0, 8), 2, start, start + 4 * 3_600_000), null);
});

test('creates a locked plan with savings and active-state metadata', () => {
    const start = Date.parse('2026-09-28T00:00:00Z');
    const plan = createPlan(
        quarterHourEntries(start, [0.30, 0.10, 0.50, 0.05]),
        2,
        { startMs: start, endMs: start + 4 * 3_600_000, key: new Date(start).toISOString() },
    );

    assert.ok(plan);
    assert.equal(plan.settled, true);
    assert.ok(Math.abs(plan.averageValue - 0.075) < 1e-12);
    assert.equal(plan.windowAverageValue, 0.2375);
    assert.ok(plan.savingPercent > 68 && plan.savingPercent < 69);
    assert.deepEqual(planState(plan, start + 90 * 60_000), {
        active: true,
        activeUntil: '2026-09-28T02:00:00.000Z',
        nextStart: '2026-09-28T03:00:00.000Z',
    });
});

test('forecast-backed plans are marked unsettled and contiguous picks share one active-until time', () => {
    const start = Date.parse('2026-09-28T00:00:00Z');
    const plan = createPlan(
        quarterHourEntries(start, [0.05, 0.06, 0.50], 'forecast'),
        2,
        { startMs: start, endMs: start + 3 * 3_600_000, key: new Date(start).toISOString() },
    );

    assert.ok(plan);
    assert.equal(plan.settled, false);
    assert.deepEqual(planState(plan, start + 30 * 60_000), {
        active: true,
        activeUntil: '2026-09-28T02:00:00.000Z',
        nextStart: '2026-09-28T01:00:00.000Z',
    });
});

test('saving percentage stays empty when the block average is zero or negative', () => {
    const start = Date.parse('2026-09-28T00:00:00Z');
    const plan = createPlan(
        quarterHourEntries(start, [-0.10, 0.10]),
        1,
        { startMs: start, endMs: start + 2 * 3_600_000, key: new Date(start).toISOString() },
    );

    assert.ok(plan);
    assert.equal(plan.windowAverageValue, 0);
    assert.equal(plan.savingPercent, null);
});
