const { SpokeoProvider } = require('./spokeo');
const { getProxyUrl, proxyFetch } = require('./proxy-fetch');

class PeopleDataLabsProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async enrich(parcel) {
    const response = await proxyFetch('https://api.peopledatalabs.com/v5/person/enrich', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: parcel.owner,
        street_address: parcel.mailingAddress?.line1 || parcel.address,
        locality: parcel.mailingAddress?.city || parcel.city,
        region: parcel.mailingAddress?.state || parcel.mailState,
        postal_code: parcel.mailingAddress?.zip
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      phone: data.data?.phone_numbers?.[0]?.number || null,
      email: data.data?.emails?.[0]?.address || null,
      skiptraceSource: 'peopledatalabs',
      source: 'peopledatalabs'
    };
  }
}

class ReishubProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async enrich(parcel) {
    const response = await proxyFetch('https://api.reishub.com/v1/skiptrace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        full_name: parcel.owner,
        address: parcel.mailingAddress?.line1 || parcel.address,
        city: parcel.mailingAddress?.city || parcel.city,
        state: parcel.mailingAddress?.state || parcel.mailState,
        zip: parcel.mailingAddress?.zip,
        parcel_id: parcel.parcelId
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      phone: data.contact?.phone || data.phone || null,
      email: data.contact?.email || data.email || null,
      skiptraceSource: 'reishub',
      source: 'reishub'
    };
  }
}

function createSkiptraceProvider() {
  const provider = (process.env.CONTACT_PROVIDER || process.env.SKIPTRACE_PROVIDER || '').toLowerCase();
  const apiKey =
    process.env.SPOKEO_API_KEY ||
    process.env.CONTACT_API_KEY ||
    process.env.SPOKEO_KEY ||
    null;

  if (!apiKey) return null;

  if (provider === 'spokeo') {
    return new SpokeoProvider(apiKey, { delayMs: process.env.SPOKEO_DELAY_MS });
  }
  if (provider === 'peopledatalabs') return new PeopleDataLabsProvider(apiKey);
  if (provider === 'reishub') return new ReishubProvider(apiKey);

  return null;
}

function skiptraceConfigHelp() {
  return `
Spokeo skiptrace setup (official API — not web scraping):

  export CONTACT_PROVIDER=spokeo
  export SPOKEO_API_KEY=your_spokeo_business_api_key

Optional proxy (residential/datacenter):

  export SPOKEO_PROXY_URL=http://user:pass@host:port
  # or standard:
  export HTTPS_PROXY=http://user:pass@host:port

Optional rate limit (ms between API calls, default 600):

  export SPOKEO_DELAY_MS=800

Get API access: https://www.spokeo.com/business/api
Docs: https://docs.spokeo.com/

Proxy in use: ${getProxyUrl() ? 'yes' : 'no (direct connection)'}
`;
}

module.exports = { createSkiptraceProvider, skiptraceConfigHelp, SpokeoProvider };