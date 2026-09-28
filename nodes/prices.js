'use strict';

const { registerRequestNode } = require('../lib/runtime');

module.exports = function registerPricesNode(RED) {
    registerRequestNode(RED, 'energypriceforecast-prices', 'prices');
};
