'use strict';

const DEFAULT_BASE_URL = 'https://api.energypriceforecast.eu';
const DEFAULT_TIMEOUT_MS = 20_000;
const REJECTED_API_KEY_STATES = new Set(['invalid', 'invalid_format', 'revoked', 'inactive', 'expired']);

class ApiError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = options.status;
        this.detail = options.detail;
        this.code = options.code;
        this.cause = options.cause;
    }
}

function normalizeBaseUrl(value) {
    const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new ApiError('The configured API base URL is invalid.');
    }
    const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHttpHosts.has(url.hostname))) {
        throw new ApiError('The configured API base URL must use HTTPS (HTTP is allowed only for localhost).');
    }
    return url.toString().replace(/\/+$/, '');
}

function apiDetail(body) {
    if (!body || typeof body !== 'object') return null;
    for (const key of ['detail', 'message', 'error']) {
        if (typeof body[key] === 'string' && body[key].trim()) return body[key].trim();
    }
    return null;
}

async function getJson(path, params, options = {}) {
    const url = new URL(`${normalizeBaseUrl(options.baseUrl)}/api/v1/node-red/${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    const headers = {
        Accept: 'application/json',
        'User-Agent': options.userAgent || '@backupbattery/node-red-energypriceforecast',
    };
    if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

    let response;
    try {
        response = await fetch(url, { headers, signal: options.signal });
    } catch (error) {
        const timedOut = options.signal && options.signal.aborted;
        throw new ApiError(timedOut ? `${path} request timed out or was cancelled.` : `${path} request failed: ${error.message}`, {
            code: timedOut ? 'request_aborted' : 'network_error',
            cause: error,
        });
    }

    let body;
    try {
        body = await response.json();
    } catch (error) {
        throw new ApiError(`${path} answered HTTP ${response.status} without valid JSON.`, {
            status: response.status,
            code: 'invalid_json',
            cause: error,
        });
    }

    if (!response.ok) {
        const detail = apiDetail(body);
        throw new ApiError(`${path} answered HTTP ${response.status}${detail ? `: ${detail}` : '.'}`, {
            status: response.status,
            detail,
            code: 'http_error',
        });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(`${path} returned an unexpected response.`, { code: 'invalid_response' });
    }
    const expectedFormat = `node-red-${path}`;
    if (body.format !== expectedFormat) {
        throw new ApiError(`${path} returned an unexpected format.`, { code: 'invalid_response' });
    }
    return body;
}

function retailParams(options) {
    if (options.priceMode !== 'retail') return {};
    return {
        price_mode: 'retail',
        plz: options.postalCode || undefined,
    };
}

function fetchSummary(options) {
    return getJson(
        'summary',
        {
            country: options.market.toLowerCase(),
            hours: options.hours,
            summary_hours: options.hours,
            window_hours: options.windowHours,
            currency: options.currency === 'auto' ? undefined : options.currency,
            ...retailParams(options),
        },
        options,
    );
}

function fetchPrices(options) {
    return getJson(
        'prices',
        {
            country: options.market.toLowerCase(),
            hours: options.hours,
            mode: options.mode,
            resolution: options.resolution,
            currency: options.currency === 'auto' ? undefined : options.currency,
            ...retailParams(options),
        },
        options,
    );
}

module.exports = {
    ApiError,
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_MS,
    REJECTED_API_KEY_STATES,
    fetchPrices,
    fetchSummary,
    normalizeBaseUrl,
};
