'use strict';

const { evaluateSignal } = require('../lib/signal');

const THRESHOLD_DEFAULTS = {
    price_below: 0.10,
    price_above: 0.30,
    co2_below: 200,
    co2_above: 500,
    combined_score_at_least: 80,
    data_current: 75,
};

module.exports = function registerSignalNode(RED) {
    function EnergyPriceForecastSignal(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const rule = String(config.rule || 'cheapest_window_active');
        const emitMode = config.emitMode === 'changes' ? 'changes' : 'every';
        const emitInitial = config.emitInitial === true || config.emitInitial === 'true';
        const configuredThreshold = config.threshold === '' || config.threshold === undefined || config.threshold === null
            ? Number.NaN
            : Number(config.threshold);
        const threshold = Number.isFinite(configuredThreshold)
            ? configuredThreshold
            : THRESHOLD_DEFAULTS[rule];
        let initialized = false;
        let previous = null;

        node.on('input', (msg, send, done) => {
            send = send || ((messages) => node.send(messages));
            try {
                const result = evaluateSignal(rule, threshold, msg);
                const changed = initialized && result.active !== previous;
                const shouldSend = emitMode === 'every' || changed || (!initialized && emitInitial);
                msg.energypriceforecast = msg.energypriceforecast && typeof msg.energypriceforecast === 'object'
                    ? msg.energypriceforecast
                    : {};
                msg.energypriceforecast.signal = {
                    rule,
                    active: result.active,
                    value: result.value,
                    threshold: THRESHOLD_DEFAULTS[rule] === undefined ? null : threshold,
                    previous: initialized ? previous : null,
                    changed,
                    evaluatedAt: new Date().toISOString(),
                };
                msg.topic = `energypriceforecast/signal/${rule}/${result.active ? 'on' : 'off'}`;
                node.status({
                    fill: result.active ? 'green' : 'grey',
                    shape: result.active ? 'dot' : 'ring',
                    text: result.active ? 'true' : 'false',
                });
                previous = result.active;
                initialized = true;
                if (shouldSend) send(result.active ? [msg, null] : [null, msg]);
                if (done) done();
            } catch (error) {
                node.status({ fill: 'red', shape: 'ring', text: 'invalid input' });
                if (done) done(error); else node.error(error, msg);
            }
        });
    }

    RED.nodes.registerType('energypriceforecast-signal', EnergyPriceForecastSignal);
};
