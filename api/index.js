const app = require('../app');

function restoreRewrittenPath(request) {
  const url = new URL(request.url, 'http://localhost');
  const originalPath = url.searchParams.get('__path');
  if (!originalPath) return;

  url.searchParams.delete('__path');
  const search = url.searchParams.toString();
  request.url = `${originalPath}${search ? `?${search}` : ''}`;
}

function handler(request, response) {
  restoreRewrittenPath(request);
  return app(request, response);
}

module.exports = handler;
module.exports.restoreRewrittenPath = restoreRewrittenPath;
