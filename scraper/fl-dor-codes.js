const FL_DOR = {
  '0000': { label: 'Vacant Residential', category: 'Vacant Land', allowsMH: true, allowsResidential: true },
  '0010': { label: 'Vacant Commercial', category: 'Commercial', allowsMH: false, allowsResidential: false },
  '0020': { label: 'Vacant Industrial', category: 'Industrial', allowsMH: false, allowsResidential: false },
  '0030': { label: 'Vacant Institutional', category: 'Institutional', allowsMH: false, allowsResidential: false },
  '0040': { label: 'Vacant Government', category: 'Government', allowsMH: false, allowsResidential: false },
  '0050': { label: 'Vacant Agricultural', category: 'Agricultural', allowsMH: true, allowsResidential: true },
  '0100': { label: 'Single Family Residential', category: 'Residential', allowsMH: false, allowsResidential: true },
  '0200': { label: 'Mobile Home', category: 'Mobile Home', allowsMH: true, allowsResidential: true },
  '0300': { label: 'Multi-Family (10+ units)', category: 'Multi-Family', allowsMH: false, allowsResidential: true },
  '0400': { label: 'Condominium', category: 'Residential', allowsMH: false, allowsResidential: true },
  '0500': { label: 'Cooperatives', category: 'Residential', allowsMH: false, allowsResidential: true },
  '0600': { label: 'Retirement Homes', category: 'Residential', allowsMH: false, allowsResidential: true },
  '0700': { label: 'Misc Residential', category: 'Residential', allowsMH: true, allowsResidential: true },
  '0800': { label: 'Multi-Family (less than 10)', category: 'Multi-Family', allowsMH: false, allowsResidential: true },
  '0900': { label: 'Residential Common Elements', category: 'Residential', allowsMH: false, allowsResidential: true },
  '1000': { label: 'Vacant Commercial', category: 'Commercial', allowsMH: false, allowsResidential: false },
  '1100': { label: 'Stores, One Story', category: 'Commercial', allowsMH: false, allowsResidential: false },
  '3000': { label: 'Vacant Industrial', category: 'Industrial', allowsMH: false, allowsResidential: false },
  '8600': { label: 'Golf Courses', category: 'Recreation', allowsMH: false, allowsResidential: false },
  '8800': { label: 'Utility / Right-of-Way', category: 'Utility', allowsMH: false, allowsResidential: false }
};

function normalizeDorCode(code = '') {
  const digits = String(code).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 4) return digits.slice(0, 4);
  return digits.padStart(4, '0');
}

function lookupDorCode(code = '') {
  const normalized = normalizeDorCode(code);
  if (!normalized) return null;
  if (FL_DOR[normalized]) return { code: normalized, ...FL_DOR[normalized] };

  const prefix3 = normalized.slice(0, 3) + '0';
  if (FL_DOR[prefix3]) return { code: normalized, ...FL_DOR[prefix3] };

  const family = `${normalized[0]}000`;
  if (FL_DOR[family]) {
    return {
      code: normalized,
      label: FL_DOR[family].label,
      category: FL_DOR[family].category,
      allowsMH: FL_DOR[family].allowsMH,
      allowsResidential: FL_DOR[family].allowsResidential
    };
  }

  return null;
}

module.exports = { FL_DOR, normalizeDorCode, lookupDorCode };