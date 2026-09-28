'use strict';

const MARKET_TIME_ZONES = {
    AT: 'Europe/Vienna', BE: 'Europe/Brussels', BG: 'Europe/Sofia', CH: 'Europe/Zurich',
    CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK1: 'Europe/Copenhagen', DK2: 'Europe/Copenhagen',
    ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris', GR: 'Europe/Athens',
    ITN: 'Europe/Rome', IT_CNOR: 'Europe/Rome', IT_CSUD: 'Europe/Rome', IT_SUD: 'Europe/Rome',
    IT_CALA: 'Europe/Rome', IT_SICI: 'Europe/Rome', IT_SARD: 'Europe/Rome', NL: 'Europe/Amsterdam',
    NO1: 'Europe/Oslo', NO2: 'Europe/Oslo', NO3: 'Europe/Oslo', NO4: 'Europe/Oslo', NO5: 'Europe/Oslo',
    PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', RO: 'Europe/Bucharest', SE1: 'Europe/Stockholm',
    SE2: 'Europe/Stockholm', SE3: 'Europe/Stockholm', SE4: 'Europe/Stockholm', SK: 'Europe/Bratislava',
};

function localParts(timestampMs, timeZone) {
    const values = {};
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(timestampMs));
    for (const part of parts) {
        if (['year', 'month', 'day', 'hour'].includes(part.type)) values[part.type] = Number(part.value);
    }
    if (['year', 'month', 'day', 'hour'].some((key) => !Number.isInteger(values[key]))) {
        throw new Error(`Unable to resolve local time in ${timeZone}.`);
    }
    return values;
}

function shiftLocalHours(value, hours) {
    const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour + hours));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
    };
}

function sameLocal(a, b) {
    return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour;
}

function assertTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en', { timeZone }).format();
    } catch {
        throw new Error(`Invalid IANA time zone: ${timeZone}.`);
    }
}

function resolveLocalHour(target, timeZone) {
    const naive = Date.UTC(target.year, target.month - 1, target.day, target.hour);
    const exact = [];
    let firstLater = null;
    for (let timestamp = naive - 14 * 3_600_000; timestamp <= naive + 14 * 3_600_000; timestamp += 15 * 60_000) {
        const local = localParts(timestamp, timeZone);
        if (sameLocal(local, target)) exact.push(timestamp);
        if (local.year === target.year && local.month === target.month && local.day === target.day
            && local.hour > target.hour && (!firstLater || local.hour < firstLater.hour)) {
            firstLater = { timestamp, hour: local.hour };
        }
    }
    if (exact.length) return Math.min(...exact);
    if (firstLater) return firstLater.timestamp;
    throw new Error(`The configured local hour cannot be resolved in ${timeZone}.`);
}

function validateDayHour(startDay, startHour) {
    if (!Number.isInteger(startDay) || startDay < 1 || startDay > 7) {
        throw new Error('Start day must be between Monday (1) and Sunday (7).');
    }
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
        throw new Error('Start hour must be a whole number from 0 to 23.');
    }
}

function fixedRepeatingWindow(timeZone, startDay, startHour, windowHours, nowMs = Date.now()) {
    assertTimeZone(timeZone);
    validateDayHour(startDay, startHour);
    if (!Number.isInteger(windowHours) || windowHours < 2 || windowHours > 120) {
        throw new Error('Block length must be a whole number from 2 to 120 hours.');
    }
    const nowLocal = localParts(nowMs, timeZone);
    const referenceMonday = { year: 2020, month: 1, day: 6, hour: 0 };
    const reference = shiftLocalHours(referenceMonday, (startDay - 1) * 24 + startHour);
    const naiveNow = Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day, nowLocal.hour);
    const naiveReference = Date.UTC(reference.year, reference.month - 1, reference.day, reference.hour);
    let blockIndex = Math.floor((naiveNow - naiveReference) / (windowHours * 3_600_000));
    let startLocal = shiftLocalHours(reference, blockIndex * windowHours);
    let startMs = resolveLocalHour(startLocal, timeZone);
    if (startMs > nowMs) {
        blockIndex -= 1;
        startLocal = shiftLocalHours(reference, blockIndex * windowHours);
        startMs = resolveLocalHour(startLocal, timeZone);
    }
    const endMs = resolveLocalHour(shiftLocalHours(startLocal, windowHours), timeZone);
    return { startMs, endMs, key: new Date(startMs).toISOString() };
}

function weeklyWindow(timeZone, startDay, startHour, endDay = 1, endHour = 0, nowMs = Date.now()) {
    assertTimeZone(timeZone);
    validateDayHour(startDay, startHour);
    validateDayHour(endDay, endHour);
    const nowLocal = localParts(nowMs, timeZone);
    const sundayBasedDay = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day)).getUTCDay();
    const currentDay = sundayBasedDay === 0 ? 7 : sundayBasedDay;
    let daysSinceStart = (currentDay - startDay + 7) % 7;
    let startLocal = shiftLocalHours({ ...nowLocal, hour: startHour }, -daysSinceStart * 24);
    let startMs = resolveLocalHour(startLocal, timeZone);
    if (startMs > nowMs) {
        daysSinceStart += 7;
        startLocal = shiftLocalHours({ ...nowLocal, hour: startHour }, -daysSinceStart * 24);
        startMs = resolveLocalHour(startLocal, timeZone);
    }
    let daysToEnd = (endDay - startDay + 7) % 7;
    if (daysToEnd === 0 && endHour <= startHour) daysToEnd = 7;
    let endLocal = shiftLocalHours({ ...startLocal, hour: endHour }, daysToEnd * 24);
    let endMs = resolveLocalHour(endLocal, timeZone);
    if (nowMs >= endMs) {
        startLocal = shiftLocalHours(startLocal, 7 * 24);
        endLocal = shiftLocalHours(endLocal, 7 * 24);
        startMs = resolveLocalHour(startLocal, timeZone);
        endMs = resolveLocalHour(endLocal, timeZone);
    }
    return { startMs, endMs, key: new Date(startMs).toISOString() };
}

function normalizeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({
        start: Date.parse(entry && entry.start),
        end: Date.parse(entry && entry.end),
        value: Number(entry && entry.value),
        source: entry && entry.source,
    })).filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end)
        && entry.end > entry.start && Number.isFinite(entry.value))
        .sort((a, b) => a.start - b.start);
}

function integratedAverage(entries, startMs, endMs, settledOnly = false) {
    if (endMs <= startMs) return null;
    let cursor = startMs;
    let weightedValue = 0;
    let coveredMs = 0;
    for (const entry of entries) {
        if (settledOnly && (!entry.source || entry.source === 'forecast')) continue;
        if (entry.end <= cursor || entry.start >= endMs) continue;
        if (entry.start > cursor) return null;
        const overlapStart = Math.max(cursor, entry.start);
        const overlapEnd = Math.min(endMs, entry.end);
        if (overlapEnd <= overlapStart) continue;
        const duration = overlapEnd - overlapStart;
        weightedValue += entry.value * duration;
        coveredMs += duration;
        cursor = overlapEnd;
        if (cursor >= endMs) break;
    }
    return cursor >= endMs && coveredMs === endMs - startMs ? weightedValue / coveredMs : null;
}

function findCheapestHours(rawEntries, count, windowStartMs, windowEndMs) {
    if (!Number.isInteger(count) || count < 1 || windowEndMs <= windowStartMs) return null;
    const entries = normalizeEntries(rawEntries);
    const ranked = [];
    for (let start = windowStartMs; start < windowEndMs; start += 3_600_000) {
        const end = Math.min(start + 3_600_000, windowEndMs);
        const averageValue = integratedAverage(entries, start, end);
        if (averageValue === null) return null;
        ranked.push({
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            averageValue,
        });
    }
    return ranked.sort((a, b) => a.averageValue - b.averageValue || Date.parse(a.start) - Date.parse(b.start))
        .slice(0, Math.min(count, ranked.length))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function weightedMean(hours) {
    let total = 0;
    let duration = 0;
    for (const hour of hours) {
        const ms = Date.parse(hour.end) - Date.parse(hour.start);
        if (ms <= 0) continue;
        total += hour.averageValue * ms;
        duration += ms;
    }
    return duration ? total / duration : null;
}

function createPlan(rawEntries, count, window) {
    const entries = normalizeEntries(rawEntries);
    const hours = findCheapestHours(rawEntries, count, window.startMs, window.endMs);
    if (!hours || !hours.length) return null;
    const windowAverageValue = integratedAverage(entries, window.startMs, window.endMs);
    const averageValue = weightedMean(hours);
    const savingPercent = windowAverageValue !== null && windowAverageValue > 0 && averageValue !== null
        ? (windowAverageValue - averageValue) / windowAverageValue * 100
        : null;
    return {
        key: window.key,
        windowStart: new Date(window.startMs).toISOString(),
        windowEnd: new Date(window.endMs).toISOString(),
        hours,
        averageValue,
        windowAverageValue,
        savingPercent,
        settled: integratedAverage(entries, window.startMs, window.endMs, true) !== null,
        createdAt: new Date().toISOString(),
    };
}

function planState(plan, nowMs = Date.now()) {
    const ordered = plan && Array.isArray(plan.hours) ? [...plan.hours]
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) : [];
    const activeIndex = ordered.findIndex((hour) => Date.parse(hour.start) <= nowMs && nowMs < Date.parse(hour.end));
    let activeUntil = null;
    if (activeIndex >= 0) {
        let endMs = Date.parse(ordered[activeIndex].end);
        for (let index = activeIndex + 1; index < ordered.length; index += 1) {
            const startMs = Date.parse(ordered[index].start);
            if (startMs > endMs) break;
            endMs = Math.max(endMs, Date.parse(ordered[index].end));
        }
        activeUntil = new Date(endMs).toISOString();
    }
    const next = ordered.find((hour) => Date.parse(hour.start) > nowMs) || null;
    return {
        active: activeIndex >= 0,
        activeUntil,
        nextStart: next ? next.start : null,
    };
}

function timeZoneForMarket(market, configured = 'auto') {
    if (configured && configured !== 'auto') {
        assertTimeZone(configured);
        return configured;
    }
    const timeZone = MARKET_TIME_ZONES[String(market || '').toUpperCase()];
    if (!timeZone) throw new Error(`No time zone is known for electricity market ${market || '(missing)'}.`);
    return timeZone;
}

module.exports = {
    MARKET_TIME_ZONES,
    createPlan,
    findCheapestHours,
    fixedRepeatingWindow,
    integratedAverage,
    normalizeEntries,
    planState,
    timeZoneForMarket,
    weeklyWindow,
};
