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

function phoneEntryScore(entry) {
  return (entry.phone_is_new_rank_one ? 4 : 0)
    + (entry.phone_is_new ? 2 : 0)
    + (entry.phones?.is_best ? 3 : 0)
    + (entry.is_wireless || entry.phones?.is_wireless ? 1 : 0);
}

function mapPhoneEntries(phones = []) {
  return phones.map((entry) => {
    const raw = entry.phone ?? entry.phones?.phone;
    const formatted = formatPhone(raw);
    if (!formatted) return null;
    return {
      phone: formatted,
      type: entry.phone_type || entry.phones?.phone_type || null,
      isDNC: !!(entry.do_not_call || entry.phones?.do_not_call || entry.is_dnc || entry.phones?.is_dnc),
      isWireless: !!(entry.is_wireless || entry.phones?.is_wireless),
      score: phoneEntryScore(entry)
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

function pickBestPhone(phones = []) {
  const mapped = mapPhoneEntries(phones);
  return mapped[0]?.phone || null;
}

function pickAllPhones(phones = []) {
  const seen = new Set();
  return mapPhoneEntries(phones)
    .map((p) => p.phone)
    .filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
}

function emailEntryScore(entry) {
  return (entry.email_is_new_rank_one ? 4 : 0)
    + (entry.email_is_new ? 2 : 0)
    + (entry.emails?.is_best ? 3 : 0);
}

function mapEmailEntries(emails = []) {
  return emails.map((entry) => {
    const raw = entry.email || entry.emails?.email;
    if (!raw) return null;
    return { email: raw, score: emailEntryScore(entry) };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

function pickBestEmail(emails = []) {
  const mapped = mapEmailEntries(emails);
  return mapped[0]?.email || null;
}

function pickAllEmails(emails = []) {
  const seen = new Set();
  return mapEmailEntries(emails)
    .map((e) => e.email)
    .filter((e) => {
      const key = e.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function contactFromSubject(subject, matchType) {
  if (!subject) return null;
  const phoneEntries = mapPhoneEntries(subject.phones || []);
  const phones = pickAllPhones(subject.phones || []);
  const emails = pickAllEmails(subject.emails || []);
  return {
    phone: phones[0] || null,
    phones,
    email: emails[0] || null,
    emails,
    isDNC: phoneEntries[0]?.isDNC || false,
    phoneType: phoneEntries[0]?.type || null,
    spokeoId: subject.id || null,
    matchType,
    ownerName: subject.names?.[0]?.full_name || null,
    source: 'spokeo'
  };
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

    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await proxyFetch(url, {
        method: 'GET',
        headers: {
          'X-api-key': this.apiKey,
          Accept: 'application/json'
        }
      });

      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Spokeo HTTP ${response.status}`);
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Spokeo HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
      return response.json();
    }
    throw lastError || new Error('Spokeo request failed');
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

    const hit = contactFromSubject(person, 'name');
    return {
      ...hit,
      age: person.age || null,
      isDeceased: person.is_deceased || false,
      aliases: (person.names || []).map((n) => n.full_name).filter(Boolean)
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

    return contactFromSubject(subject, owner ? 'address-owner' : 'address-resident');
  }

  async enrich(parcel) {
    const { mailing, situs, ownerParsed } = normalizeLead(parcel);

    let result = null;

    if (ownerParsed.kind === 'entity') {
      if (mailing.street) result = await this.searchByAddress(mailing);
      if (!result?.phone && !result?.email && situs.street) {
        const situsHit = await this.searchByAddress(situs);
        if (situsHit) result = situsHit;
      }
    } else if (ownerParsed.kind === 'individual') {
      result = await this.searchByName(parcel, mailing);
      if (!result?.phone && !result?.email) {
        result = await this.searchByName(parcel, situs);
      }
    }

    if (!result?.phone && !result?.email) {
      const addressHit = await this.searchByAddress(mailing.street ? mailing : situs);
      if (addressHit) result = addressHit;
    }

    if (!result) return null;

    return {
      phone: result.phone || null,
      phones: result.phones || [],
      email: result.email || null,
      emails: result.emails || [],
      isDNC: result.isDNC || false,
      phoneType: result.phoneType || null,
      skiptraceSource: 'spokeo',
      spokeoId: result.spokeoId || null,
      spokeoMatchType: result.matchType || null,
      spokeoOwnerName: result.ownerName || null,
      source: 'spokeo'
    };
  }
}

module.exports = {
  SpokeoProvider,
  formatPhone,
  pickBestPhone,
  pickBestEmail,
  pickAllPhones,
  pickAllEmails
};