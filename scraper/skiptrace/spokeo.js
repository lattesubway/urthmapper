const { proxyFetch } = require('./proxy-fetch');
const { parseOwnerName, parseAddressFromLead } = require('./parse-owner');

const SPOKEO_BASE = 'https://api.spokeo.com/v5';

function formatPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length !== 10) return digits.length >= 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}` : null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function pickBestPhone(phones = []) {
  if (!phones.length) return null;
  const ranked = [...phones].sort((a, b) => {
    const score = (p) => (p.phone_is_new_rank_one ? 4 : 0) + (p.phone_is_new ? 2 : 0) + (p.phones?.is_best ? 3 : 0);
    return score(b) - score(a);
  });
  const raw = ranked[0].phone ?? ranked[0].phones?.phone;
  return formatPhone(raw);
}

function pickBestEmail(emails = []) {
  if (!emails.length) return null;
  const ranked = [...emails].sort((a, b) => {
    const score = (e) => (e.email_is_new_rank_one ? 4 : 0) + (e.email_is_new ? 2 : 0) + (e.emails?.is_best ? 3 : 0);
    return score(b) - score(a);
  });
  return ranked[0].email || ranked[0].emails?.email || null;
}

function normalizeLead(parcel) {
  const mailing = parseAddressFromLead(parcel, 'mailing');
  const situs = parseAddressFromLead(parcel, 'situs');
  const ownerParsed = parseOwnerName(parcel.owner, parcel.ownerType);
  return { mailing, situs, ownerParsed };
}

class SpokeoProvider {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.delayMs = Number(options.delayMs || process.env.SPOKEO_DELAY_MS || 600);
    this.lastCallAt = 0;
  }

  async throttle() {
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.delayMs) {
      await new Promise((r) => setTimeout(r, this.delayMs - elapsed));
    }
    this.lastCallAt = Date.now();
  }

  async apiGet(path, params = {}) {
    await this.throttle();
    const url = new URL(`${SPOKEO_BASE}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    });

    const response = await proxyFetch(url, {
      method: 'GET',
      headers: {
        'X-api-key': this.apiKey,
        Accept: 'application/json'
      }
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spokeo HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    return response.json();
  }

  async searchByName(lead, address) {
    const { ownerParsed } = normalizeLead(lead);
    if (ownerParsed.kind !== 'individual') return null;

    const params = {
      first_name: ownerParsed.first_name,
      last_name: ownerParsed.last_name,
      street: address.street,
      city: address.city,
      state: address.state
    };
    if (ownerParsed.middle_name) params.middle_name = ownerParsed.middle_name;

    const data = await this.apiGet('/names', params);
    const person = data?.data?.people?.[0];
    if (!person) return null;

    return {
      phone: pickBestPhone(person.phones),
      email: pickBestEmail(person.emails),
      spokeoId: person.id || null,
      matchType: 'name',
      age: person.age || null,
      isDeceased: person.is_deceased || false,
      aliases: (person.names || []).map((n) => n.full_name).filter(Boolean),
      source: 'spokeo'
    };
  }

  async searchByAddress(address) {
    if (!address.street || !address.city || !address.state) return null;

    const data = await this.apiGet('/addresses', {
      street: address.street,
      city: address.city,
      state: address.state
    });

    const property = data?.data?.address?.properties?.[0];
    if (!property) return null;

    const owner = property.owners?.[0];
    const resident = property.residents?.[0];
    const subject = owner || resident;
    if (!subject) return null;

    return {
      phone: pickBestPhone(subject.phones),
      email: pickBestEmail(subject.emails),
      spokeoId: subject.id || null,
      matchType: owner ? 'address-owner' : 'address-resident',
      ownerName: subject.names?.[0]?.full_name || null,
      source: 'spokeo'
    };
  }

  async enrich(parcel) {
    const { mailing, situs, ownerParsed } = normalizeLead(parcel);

    let result = null;

    if (ownerParsed.kind === 'individual') {
      result = await this.searchByName(parcel, mailing);
      if (!result?.phone && !result?.email) {
        result = await this.searchByName(parcel, situs);
      }
    }

    if (!result?.phone && !result?.email) {
      const addressHit = await this.searchByAddress(mailing.street ? mailing : situs);
      if (addressHit) result = { ...addressHit, ...result };
    }

    if (!result) return null;

    return {
      phone: result.phone || null,
      email: result.email || null,
      skiptraceSource: 'spokeo',
      spokeoId: result.spokeoId || null,
      spokeoMatchType: result.matchType || null,
      spokeoOwnerName: result.ownerName || null,
      source: 'spokeo'
    };
  }
}

module.exports = { SpokeoProvider, formatPhone, pickBestPhone, pickBestEmail };