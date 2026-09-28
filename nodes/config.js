'use strict';

const { DEFAULT_BASE_URL } = require('../lib/client');

module.exports = function registerConfigNode(RED) {
    function EnergyPriceForecastConfig(config) {
        RED.nodes.createNode(this, config);
        this.name = String(config.name || '').trim();
        this.baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).trim();
    }

    RED.nodes.registerType('energypriceforecast-config', EnergyPriceForecastConfig, {
        credentials: {
            apiKey: { type: 'password' },
        },
    });
};
