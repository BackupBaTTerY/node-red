'use strict';

const packageJson = require('../package.json');
const { DEFAULT_TIMEOUT_MS, REJECTED_API_KEY_STATES, fetchPrices, fetchSummary } = require('./client');

const MARKETS = new Set([
    'AT', 'BE', 'BG', 'CH', 'CZ', 'DE', 'DK1', 'DK2', 'ES', 'FI', 'FR', 'GR',
    'ITN', 'IT_CNOR', 'IT_CSUD', 'IT_SUD', 'IT_CALA', 'IT_SICI', 'IT_SARD',
    'NL', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5', 'PL', 'PT', 'RO',
    'SE1', 'SE2', 'SE3', 'SE4', 'SK',
]);

function integer(value, fallback, min, max, label) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    }
    return parsed;
}

function choice(value, fallback, allowed, label) {
    const normalized = String(value || fallback).trim().toLowerCase();
    if (!allowed.includes(normalized)) throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
    return normalized;
}

function requestOptions(kind, nodeConfig, connection, msg) {
    const override = msg && msg.epf && typeof msg.epf === 'object' && !Array.isArray(msg.epf) ? msg.epf : {};
    const market = String(override.market || nodeConfig.market || 'DE').trim().toUpperCase();
    if (!MARKETS.has(market)) throw new Error(`Unsupported electricity market: ${market}.`);

    const options = {
        apiKey: String(connection.credentials && connection.credentials.apiKey || '').trim(),
        baseUrl: connection.baseUrl,
        market,
        hours: integer(override.hours ?? nodeConfig.hours, 48, 1, 168, 'Hours'),
        priceMode: choice(override.priceMode, nodeConfig.priceMode || 'base', ['base', 'retail'], 'Price mode'),
        postalCode: String(override.postalCode ?? nodeConfig.postalCode ?? '').trim(),
        userAgent: `${packageJson.name}/${packageJson.version}`,
    };

    if (kind === 'summary') {
        options.windowHours = integer(override.windowHours ?? nodeConfig.windowHours, 4, 1, 24, 'Window hours');
    } else {
        options.mode = choice(override.mode, nodeConfig.mode || 'mixed', ['mixed', 'forecast_only'], 'Series mode');
        options.resolution = choice(override.resolution, nodeConfig.resolution || '15m', ['15m', 'native'], 'Resolution');
    }
    return options;
}

function summaryMetadata(data) {
    const flat = data.flat || {};
    const meta = data.meta || {};
    return {
        kind: 'summary',
        generatedAt: data.generated_at || null,
        country: data.country || null,
        apiKeyState: meta.api_key_state || null,
        allowedHorizonHours: meta.allowed_horizon_hours ?? null,
        usedHorizonHours: meta.used_horizon_hours ?? null,
        currentPrice: flat.current_price ?? null,
        currentPriceUnit: flat.current_price_unit || null,
        currentPriceSource: flat.current_price_source || null,
        currentCo2GPerKwh: flat.current_co2_g_kwh ?? null,
        cheapestWindowStart: flat.cheapest_window_start || null,
        cheapestWindowEnd: flat.cheapest_window_end || null,
        isCheapestWindowNow: flat.is_cheapest_window_now === true,
        cheapestWindowRemainingMinutes: flat.cheapest_window_remaining_minutes ?? null,
        greenestWindowStart: flat.greenest_window_start || null,
        greenestWindowEnd: flat.greenest_window_end || null,
        isGreenestWindowNow: flat.is_greenest_window_now === true,
        combinedScoreNow: flat.combined_score_now ?? null,
    };
}

function pricesMetadata(data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const meta = data.meta || {};
    return {
        kind: 'prices',
        generatedAt: data.generated_at || null,
        country: data.country || null,
        apiKeyState: meta.api_key_state || null,
        allowedHorizonHours: meta.allowed_horizon_hours ?? null,
        usedHorizonHours: meta.used_horizon_hours ?? null,
        entryCount: entries.length,
        seriesStart: entries[0] && entries[0].start || null,
        seriesEnd: entries.at(-1) && entries.at(-1).end || null,
    };
}

function setSuccessStatus(node, data) {
    const apiKeyState = data && data.meta && data.meta.api_key_state;
    if (REJECTED_API_KEY_STATES.has(String(apiKeyState))) {
        node.status({ fill: 'yellow', shape: 'ring', text: `public access (${apiKeyState} key)` });
        return;
    }
    const hours = data && data.meta && data.meta.used_horizon_hours;
    node.status({ fill: 'green', shape: 'dot', text: hours ? `ok · ${hours} h` : 'ok' });
}

function registerRequestNode(RED, type, kind) {
    const fetcher = kind === 'summary' ? fetchSummary : fetchPrices;
    const metadata = kind === 'summary' ? summaryMetadata : pricesMetadata;

    function EnergyPriceForecastNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const connection = RED.nodes.getNode(config.connection);
        const activeControllers = new Set();

        if (!connection) {
            node.status({ fill: 'red', shape: 'ring', text: 'missing configuration' });
        }

        node.on('input', async (msg, send, done) => {
            send = send || ((message) => node.send(message));
            if (!connection) {
                const error = new Error('Energy Price Forecast configuration is missing.');
                if (done) done(error); else node.error(error, msg);
                return;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
            activeControllers.add(controller);
            node.status({ fill: 'blue', shape: 'dot', text: 'requesting' });

            try {
                const options = requestOptions(kind, config, connection, msg);
                options.signal = controller.signal;
                const data = await fetcher(options);
                msg.payload = data;
                msg.energypriceforecast = metadata(data);
                msg.topic = `energypriceforecast/${options.market.toLowerCase()}/${kind}`;
                setSuccessStatus(node, data);
                send(msg);
                if (done) done();
            } catch (error) {
                node.status({ fill: 'red', shape: 'ring', text: error.status ? `HTTP ${error.status}` : 'request failed' });
                if (done) done(error); else node.error(error, msg);
            } finally {
                clearTimeout(timeout);
                activeControllers.delete(controller);
            }
        });

        node.on('close', (done) => {
            for (const controller of activeControllers) controller.abort();
            activeControllers.clear();
            done();
        });
    }

    RED.nodes.registerType(type, EnergyPriceForecastNode);
}

module.exports = { MARKETS, pricesMetadata, registerRequestNode, requestOptions, summaryMetadata };
