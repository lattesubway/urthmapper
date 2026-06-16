const ENTITY_PATTERN = /\b(LLC|L\.L\.C|INC|CORP|CO\.|COMPANY|TRUST|LP|LLP|HOLDINGS|PROPERTIES|ESTATE|HEIRS?)\b/i;

function parseOwnerName(owner = '', ownerType = '') {
  const cleaned = String(owner).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { kind: 'unknown' };

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