const { lookupDorCode } = require('./fl-dor-codes');

const ZONING_RULES = [
  { pattern: /\bMH\b|MOBILE|R-MH|MHR|RMH/i, category: 'Mobile Home', description: 'Mobile/manufactured housing allowed', minLotWidth: 50, allowsMH: true, allowsResidential: true },
  { pattern: /RSF|RS-?\d|R-1|R1|R-2|R2|R-3|RES|SFR|SINGLE|RE1|RE2|RE3/i, category: 'Residential', description: 'Single-family residential', minLotWidth: 75, allowsMH: false, allowsResidential: true },
  { pattern: /RMF|RM-|MULTI|MF-|TOWN/i, category: 'Multi-Family', description: 'Multi-family residential potential', minLotWidth: 60, allowsMH: false, allowsResidential: true },
  { pattern: /AGR|AG-|A-1|A1|FARMLAND|FARM/i, category: 'Agricultural', description: 'Agricultural/rural — may allow homestead or MH by county', minLotWidth: 100, allowsMH: true, allowsResidential: true },
  { pattern: /COM|C-1|C1|C-2|CBD|BIZ|COMMERCIAL|CN/i, category: 'Commercial', description: 'Commercial use — higher exit value potential', minLotWidth: 100, allowsMH: false, allowsResidential: false },
  { pattern: /IND|I-1|I1|M-1|LIGHT IND/i, category: 'Industrial', description: 'Industrial/light industrial zoning', minLotWidth: 150, allowsMH: false, allowsResidential: false },
  { pattern: /PUD|PLD|PD-|PLANNED/i, category: 'Planned Development', description: 'Planned unit development — check subdivision rules', minLotWidth: 75, allowsMH: false, allowsResidential: true },
  { pattern: /OUE|OPEN|CONSERV|ENV|GREEN/i, category: 'Open/Conservation', description: 'Open use or conservation — limited development', minLotWidth: 150, allowsMH: false, allowsResidential: false }
];

const COUNTY_ZONING_HINTS = {
  Pasco: { dorField: 'DIR_CLASS', note: 'DIR_CLASS is FL DOR land use code' },
  Pinellas: { dorField: 'USE_CODE', note: 'USE_CODE is land use classification' },
  Hillsborough: { dorField: 'DOR_CODE', note: 'DOR_CODE is state land use code' },
  Sarasota: { dorField: 'STCD', zoningField: 'ZONING' },
  Manatee: { zoningField: 'PAR_ZONING' }
};

function isNumericLandUseCode(value = '') {
  return /^\d{2,4}$/.test(String(value).trim());
}

function categorizeZoning(zoning = '', dorCode = '', options = {}) {
  const county = options.county || '';
  const landUseDesc = options.landUseDescription || '';

  const dorHit = lookupDorCode(dorCode || (isNumericLandUseCode(zoning) ? zoning : ''));
  if (dorHit) {
    return {
      category: dorHit.category,
      description: `${dorHit.label} (FL DOR ${dorHit.code})`,
      minLotWidth: dorHit.category === 'Agricultural' ? 100 : 75,
      allowsMH: dorHit.allowsMH,
      allowsResidential: dorHit.allowsResidential,
      zoningSource: 'fl-dor-code',
      landUseLabel: dorHit.label
    };
  }

  const code = `${zoning} ${dorCode}`.trim();
  if (!code) {
    return {
      category: 'Unknown',
      description: 'Zoning not reported by county GIS',
      minLotWidth: 75,
      allowsMH: false,
      allowsResidential: true,
      zoningSource: 'unknown'
    };
  }

  for (const rule of ZONING_RULES) {
    if (rule.pattern.test(code)) {
      return {
        category: rule.category,
        description: rule.description,
        minLotWidth: rule.minLotWidth,
        allowsMH: rule.allowsMH,
        allowsResidential: rule.allowsResidential,
        zoningSource: 'zoning-code',
        landUseLabel: zoning
      };
    }
  }

  const hint = COUNTY_ZONING_HINTS[county];
  const fallbackDesc = landUseDesc
    ? landUseDesc.slice(0, 80)
    : hint
      ? `${county} code ${zoning || dorCode} (${hint.note})`
      : `County code: ${zoning || dorCode}`;

  return {
    category: 'Other',
    description: fallbackDesc,
    minLotWidth: 75,
    allowsMH: false,
    allowsResidential: true,
    zoningSource: 'county-code',
    landUseLabel: zoning || dorCode
  };
}

module.exports = { categorizeZoning, ZONING_RULES, COUNTY_ZONING_HINTS };