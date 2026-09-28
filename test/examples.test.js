'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('all example files are importable Node-RED flow arrays', () => {
    const directory = path.join(__dirname, '..', 'examples');
    const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));

    assert.ok(files.length >= 2);
    for (const file of files) {
        const flow = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        assert.ok(Array.isArray(flow), `${file} must contain a flow array`);
        assert.ok(flow.some((node) => node.type && node.type.startsWith('energypriceforecast-')),
            `${file} must use an Energy Price Forecast node`);
    }
});
