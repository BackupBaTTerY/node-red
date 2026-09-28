'use strict';

const SIGNAL_RULES = new Set([
    'cheapest_window_active',
    'greenest_window_active',
    'combined_window_active',
    'price_below',
    'price_above',
    'co2_below',
    'co2_above',
    'combined_score_at_least',
    'data_current',
]);

function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function summaryParts(msg) {
    const payload = msg && msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
    const metadata = msg && msg.energypriceforecast && typeof msg.energypriceforecast === 'object'
        ? msg.energypriceforecast
        : {};
    const flat = payload.flat && typeof payload.flat === 'object' ? payload.flat : {};
    return { payload, metadata, flat };
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function activeWindow(start, end, nowMs) {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return startMs <= nowMs && nowMs < endMs;
}

function evaluateSignal(rule, threshold, msg, nowMs = Date.now()) {
    if (!SIGNAL_RULES.has(rule)) throw new Error(`Unsupported Energy Price Forecast signal rule: ${rule}.`);
    const { payload, metadata, flat } = summaryParts(msg);
    let value;
    let active;

    switch (rule) {
    case 'cheapest_window_active':
        value = firstDefined(flat.is_cheapest_window_now, metadata.isCheapestWindowNow);
        active = typeof value === 'boolean' ? value : null;
        break;
    case 'greenest_window_active':
        value = firstDefined(flat.is_greenest_window_now, metadata.isGreenestWindowNow);
        active = typeof value === 'boolean' ? value : null;
        break;
    case 'combined_window_active': {
        const start = firstDefined(flat.combined_window_start, metadata.combinedWindowStart);
        const end = firstDefined(flat.combined_window_end, metadata.combinedWindowEnd);
        active = activeWindow(start, end, nowMs);
        value = active;
        break;
    }
    case 'price_below':
    case 'price_above':
        value = finiteNumber(firstDefined(flat.current_price, metadata.currentPrice));
        active = value === null ? null : rule === 'price_below' ? value < threshold : value > threshold;
        break;
    case 'co2_below':
    case 'co2_above':
        value = finiteNumber(firstDefined(flat.current_co2_g_kwh, metadata.currentCo2GPerKwh));
        active = value === null ? null : rule === 'co2_below' ? value < threshold : value > threshold;
        break;
    case 'combined_score_at_least':
        value = finiteNumber(firstDefined(flat.combined_score_now, metadata.combinedScoreNow));
        active = value === null ? null : value >= threshold;
        break;
    case 'data_current': {
        const generatedAt = firstDefined(payload.generated_at, metadata.generatedAt);
        const generatedAtMs = Date.parse(generatedAt);
        value = Number.isFinite(generatedAtMs) ? Math.max(0, (nowMs - generatedAtMs) / 60_000) : null;
        active = value === null ? null : value <= threshold;
        break;
    }
    default:
        active = null;
    }

    if (active === null) {
        throw new Error(`The input does not contain the data required for signal rule ${rule}.`);
    }
    return { active, value };
}

module.exports = { SIGNAL_RULES, evaluateSignal };
