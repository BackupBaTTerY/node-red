'use strict';

const {
    createPlan,
    fixedRepeatingWindow,
    planState,
    timeZoneForMarket,
    weeklyWindow,
} = require('../lib/planner');

function wholeNumber(value, fallback, min, max, label) {
    const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    }
    return parsed;
}

module.exports = function registerPlannerNode(RED) {
    function EnergyPriceForecastPlanner(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const planType = config.planType === 'weekend' ? 'weekend' : 'repeating';
        const emitMode = config.emitMode === 'changes' ? 'changes' : 'every';
        const emitInitial = config.emitInitial === true || config.emitInitial === 'true';
        let initialized = false;
        let previous = null;

        node.on('input', (msg, send, done) => {
            send = send || ((messages) => node.send(messages));
            try {
                const payload = msg && msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
                if (!Array.isArray(payload.entries)) {
                    throw new Error('EPF planner needs msg.payload.entries from an EPF prices node.');
                }
                const market = String(payload.country || msg.energypriceforecast && msg.energypriceforecast.country || '').toUpperCase();
                const timeZone = timeZoneForMarket(market, String(config.timeZone || 'auto').trim());
                const selectedHours = wholeNumber(config.selectedHours, 4, 1, 120, 'Selected hours');
                const startDay = wholeNumber(config.startDay, planType === 'weekend' ? 6 : 1, 1, 7, 'Start day');
                const startHour = wholeNumber(config.startHour, 0, 0, 23, 'Start hour');
                const nowMs = Date.now();
                let window;
                let planDescription;
                if (planType === 'weekend') {
                    if (![5, 6].includes(startDay)) throw new Error('A weekend plan must start on Friday or Saturday.');
                    window = weeklyWindow(timeZone, startDay, startHour, 1, 0, nowMs);
                    planDescription = `weekend from ${startDay === 5 ? 'Friday' : 'Saturday'} ${String(startHour).padStart(2, '0')}:00`;
                } else {
                    const blockHours = wholeNumber(config.blockHours, 24, 2, 120, 'Block length');
                    if (selectedHours > blockHours) throw new Error('Selected hours must not exceed the repeating block length.');
                    window = fixedRepeatingWindow(timeZone, startDay, startHour, blockHours, nowMs);
                    planDescription = `${selectedHours} of ${blockHours} hours`;
                }

                const key = [planType, selectedHours, config.blockHours || '', startDay, startHour, timeZone, window.key].join('|');
                let plans = node.context().get('plans');
                if (!plans || typeof plans !== 'object' || Array.isArray(plans)) plans = {};
                let plan = plans[key];
                if (!plan) {
                    plan = createPlan(payload.entries, selectedHours, window);
                    if (plan) {
                        plans[key] = plan;
                        plans = Object.fromEntries(Object.entries(plans).slice(-50));
                        node.context().set('plans', plans);
                    }
                }

                const windowActive = window.startMs <= nowMs && nowMs < window.endMs;
                if (!plan && windowActive) {
                    throw new Error('The complete active planning block is not covered by the price series. Keep the previous safe state and increase the requested horizon if necessary.');
                }

                const state = plan ? planState(plan, nowMs) : { active: false, activeUntil: null, nextStart: null };
                const changed = initialized && state.active !== previous;
                const shouldSend = emitMode === 'every' || changed || (!initialized && emitInitial);
                msg.energypriceforecast = msg.energypriceforecast && typeof msg.energypriceforecast === 'object'
                    ? msg.energypriceforecast
                    : {};
                msg.energypriceforecast.plan = {
                    type: planType,
                    description: planDescription,
                    available: Boolean(plan),
                    locked: Boolean(plan),
                    key,
                    timeZone,
                    selectedHours,
                    windowStart: new Date(window.startMs).toISOString(),
                    windowEnd: new Date(window.endMs).toISOString(),
                    hours: plan ? plan.hours : [],
                    averageValue: plan ? plan.averageValue : null,
                    windowAverageValue: plan ? plan.windowAverageValue : null,
                    savingPercent: plan ? plan.savingPercent : null,
                    settled: plan ? plan.settled : false,
                    active: state.active,
                    activeUntil: state.activeUntil,
                    nextStart: state.nextStart,
                    previous: initialized ? previous : null,
                    changed,
                    evaluatedAt: new Date(nowMs).toISOString(),
                };
                msg.topic = `energypriceforecast/plan/${planType}/${state.active ? 'on' : 'off'}`;
                if (!plan) {
                    node.status({ fill: 'yellow', shape: 'ring', text: 'waiting for complete window' });
                } else {
                    node.status({
                        fill: state.active ? 'green' : 'grey',
                        shape: state.active ? 'dot' : 'ring',
                        text: state.active ? `active until ${state.activeUntil}` : state.nextStart ? `next ${state.nextStart}` : 'plan complete',
                    });
                }
                previous = state.active;
                initialized = true;
                if (shouldSend) send(state.active ? [msg, null] : [null, msg]);
                if (done) done();
            } catch (error) {
                node.status({ fill: 'red', shape: 'ring', text: 'plan unavailable' });
                if (done) done(error); else node.error(error, msg);
            }
        });
    }

    RED.nodes.registerType('energypriceforecast-planner', EnergyPriceForecastPlanner);
};
