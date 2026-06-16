const { fetch: undiciFetch, ProxyAgent } = require('undici');

function getProxyUrl() {
  return (
    process.env.SPOKEO_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

function createDispatcher() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;
  return new ProxyAgent(proxyUrl);
}

let dispatcher = null;

function getDispatcher() {
  if (!getProxyUrl()) return undefined;
  if (!dispatcher) dispatcher = createDispatcher();
  return dispatcher;
}

async function proxyFetch(url, options = {}) {
  const dispatcherInstance = getDispatcher();
  const init = { ...options };
  if (dispatcherInstance) {
    init.dispatcher = dispatcherInstance;
  }
  return undiciFetch(url, init);
}

module.exports = { proxyFetch, getProxyUrl, getDispatcher };