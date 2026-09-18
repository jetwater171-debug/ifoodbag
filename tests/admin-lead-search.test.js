const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function internals(file, names) {
    const filename = path.resolve(__dirname, '..', file);
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(`${fs.readFileSync(filename, 'utf8')}\nmodule.exports.test = { ${names} };`, filename);
    return mod.exports.test;
}

const admin = internals(
    'lib/admin-api-handler.js',
    'extractCampaignSearchValue, buildLeadSearchOrFilter'
);

test('lead search accepts a raw campaign id', () => {
    const filter = admin.buildLeadSearchOrFilter('1202159087654321');

    assert.match(filter, /utm_campaign\.ilike\.\*1202159087654321\*/);
    assert.match(filter, /payload->>campaign_id\.ilike\.\*1202159087654321\*/);
    assert.match(filter, /payload->utm->>campaign_id\.ilike\.\*1202159087654321\*/);
});

test('lead search removes common campaign id labels', () => {
    assert.equal(admin.extractCampaignSearchValue('ID da campanha: 1202159087654321'), '1202159087654321');
    assert.equal(admin.extractCampaignSearchValue('campaign_id=987654321'), '987654321');

    const filter = admin.buildLeadSearchOrFilter('ID da campanha: 1202159087654321');
    assert.match(filter, /payload->utm->>utm_campaign\.ilike\.\*1202159087654321\*/);
    assert.match(filter, /payload->utm->>sck\.ilike\.\*1202159087654321\*/);
});

test('existing lead search fields remain available', () => {
    const filter = admin.buildLeadSearchOrFilter('maria@example.com');

    assert.match(filter, /name\.ilike\.\*maria@example\.com\*/);
    assert.match(filter, /email\.ilike\.\*maria@example\.com\*/);
    assert.match(filter, /session_id\.ilike\.\*maria@example\.com\*/);
});
