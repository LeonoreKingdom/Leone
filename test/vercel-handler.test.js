const assert = require('node:assert/strict');
const test = require('node:test');

const { restoreRewrittenPath } = require('../api');

test('restores an API path and preserves incoming query parameters', () => {
  const request = {
    url: '/api/index?__path=%2Fapi%2Fv1%2Ffamily%2F123&visibility=public',
  };

  restoreRewrittenPath(request);

  assert.equal(request.url, '/api/v1/family/123?visibility=public');
});

test('leaves direct function requests unchanged', () => {
  const request = { url: '/api/index?check=true' };

  restoreRewrittenPath(request);

  assert.equal(request.url, '/api/index?check=true');
});
