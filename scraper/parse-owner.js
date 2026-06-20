const ENTITY_PATTERN = /\b(LLC|L\.L\.C|INC|CORP|CO\.|COMPANY|TRUST|LP|LLP|HOLDINGS|PROPERTIES|ESTATE|HEIRS?)\b/i;

// Florida parcel rolls frequently bury a real, traceable human inside a trust/estate
// string, e.g. "HAFTEL DESCENDANTS TRUST HAFTEL GARY TRUSTEE" -> Gary Haftel (trustee).
// Pull the 2-3 name tokens immediately preceding a trustee / personal-rep marker.
const TRUSTEE_MARKER = /\b(CO-?TRUSTEES?|TRUSTEES?|TTEE|PERS(?:ONAL)?\s+REP(?:RESENTATIVE)?|EXECUTOR|ADMINISTRATOR)\b/i;
const TRUST_DESCRIPTOR = /^(REVOCABLE|IRREVOCABLE|LIVING|FAMILY|DESCENDANTS?|JOINT|LAND|TRUST|THE|OF|DATED|DTD|UA|UDT|UTD|EST|ESTATE|AND|&)$/i;

function extractTrustee(cleaned = '') {
  const mk = cleaned.match(TRUSTEE_MARKER);
  if (!mk) return null;
  const before = cleaned.slice(0, mk.index).trim();
  const toks = before.split(/\s+/).filter(Boolean);
  const nameToks = [];
  for (let i = toks.length - 1; i >= 0 && nameToks.length < 3; i -= 1) {
    const t = toks[i];
    if (TRUST_DESCRIPTOR.test(t)) break;
    if (!/^[A-Za-z][A-Za-z'’-]*$/.test(t)) break; // alpha tokens only
    nameToks.unshift(t);
  }
  if (nameToks.length < 2) return null;
  // A corporate trustee ("CHAMPIONSHIP DANCE INC TRUSTEE") is not a traceable person.
  if (nameToks.some(t => /^(INC|LLC|CORP|CO|COMPANY|BANK|NA|TRUST|ASSOC|LP|LLP|PA)$/i.test(t))) return null;
  // Name order varies (LAST FIRST vs FIRST LAST). The family surname usually leads the
  // trust string, so if a trustee token matches it, that token is the last name.
  const leadSurname = (cleaned.split(/\s+/)[0] || '').toUpperCase();
  const matchIdx = nameToks.findIndex(t => t.toUpperCase() === leadSurname);
  let first, middle, last;
  if (matchIdx >= 0) {
    last = nameToks[matchIdx];
    const rest = nameToks.filter((_, i) => i !== matchIdx);
    first = rest[0];
    middle = rest.length > 1 ? rest.slice(1).join(' ') : undefined;
  } else {
    // Fall back to the Florida roll convention: LAST FIRST [MIDDLE]
    last = nameToks[0];
    first = nameToks[1];
    middle = nameToks.length > 2 ? nameToks.slice(2).join(' ') : undefined;
  }
  return { kind: 'individual', first_name: first, middle_name: middle, last_name: last, derived_from: 'trustee' };
}

function parseOwnerName(owner = '', ownerType = '') {
  const cleaned = String(owner).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { kind: 'unknown' };

  // Trust / estate with a named trustee or personal rep -> trace that human, not the entity.
  if (/\b(TRUST|TTEE|TRUSTEE|ESTATE|PERS|REP|EXECUTOR|ADMINISTRATOR)\b/i.test(cleaned)) {
    const trustee = extractTrustee(cleaned);
    if (trustee) return trustee;
  }

  const upper = cleaned.toUpperCase();
  if (ownerType === 'LLC' || ownerType === 'Corporate' || ownerType === 'Trust' || ownerType === 'Estate') {
    return { kind: 'entity', fullName: cleaned };
  }
  if (ENTITY_PATTERN.test(cleaned) && !cleaned.includes(',')) {
    return { kind: 'entity', fullName: cleaned };
  }

  if (/^ESTATE OF\s+/i.test(cleaned)) {
    return parseIndividualParts(cleaned.replace(/^ESTATE OF\s+/i, ''));
  }
  if (/^HEIRS OF\s+/i.test(cleaned)) {
    return parseIndividualParts(cleaned.replace(/^HEIRS OF\s+/i, ''));
  }

  if (cleaned.includes(',')) {
    const [last, rest] = cleaned.split(',').map((s) => s.trim());
    const parts = rest.split(/\s+/).filter(Boolean);
    return {
      kind: 'individual',
      first_name: parts[0] || '',
      middle_name: parts.slice(1).join(' ') || undefined,
      last_name: last
    };
  }

  return parseIndividualParts(cleaned);
}

function parseIndividualParts(name) {
  const primary = String(name).split(/\s+&\s+/)[0].trim();
  const parts = primary.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { kind: 'individual', first_name: parts[0], last_name: parts[0] };
  }
  // Florida parcel rolls: LAST FIRST [MIDDLE] when no comma (e.g. "FULOP JUDITH E")
  return {
    kind: 'individual',
    first_name: parts[1],
    middle_name: parts.length > 2 ? parts.slice(2).join(' ') : undefined,
    last_name: parts[0]
  };
}

function parseAddressFromLead(lead, prefer = 'mailing') {
  if (prefer === 'mailing' && lead.mailingAddress && typeof lead.mailingAddress === 'object') {
    const m = lead.mailingAddress;
    return {
      street: m.line1 || m.street || '',
      city: m.city || '',
      state: (m.state || '').trim().slice(0, 2),
      zip: (m.zip || '').slice(0, 5)
    };
  }

  const raw = prefer === 'mailing' ? lead.mailingAddress : lead.situsAddress;
  if (typeof raw === 'string' && raw.length > 5) {
    return parseAddressString(raw);
  }

  return {
    street: lead.address || lead.situsAddress || '',
    city: lead.city || '',
    state: (lead.state || 'FL').trim().slice(0, 2),
    zip: ''
  };
}

function parseAddressString(full = '') {
  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { street: full, city: '', state: 'FL', zip: '' };
  }

  const street = parts[0];
  let city = '';
  let state = 'FL';
  let zip = '';

  if (parts.length >= 4 && /^[A-Z]{2}$/i.test(parts[parts.length - 2])) {
    city = parts[parts.length - 3];
    state = parts[parts.length - 2].toUpperCase();
    zip = (parts[parts.length - 1].match(/\d{5}/) || [])[0] || '';
  } else {
    city = parts.length >= 3 ? parts[parts.length - 2] : parts[1];
    const stateZip = parts[parts.length - 1] || '';
    const stateMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
    state = stateMatch?.[1]?.toUpperCase() || (parts.length >= 3 ? parts[parts.length - 2] : 'FL');
    zip = stateMatch?.[2] || (stateZip.match(/\d{5}/) || [])[0] || '';
  }

  return { street, city, state: String(state).trim().slice(0, 2), zip };
}

module.exports = { parseOwnerName, parseAddressFromLead, parseAddressString };