'use strict';

const { registerRequestNode } = require('../lib/runtime');

module.exports = function registerSummaryNode(RED) {
    registerRequestNode(RED, 'energypriceforecast-summary', 'summary');
};
