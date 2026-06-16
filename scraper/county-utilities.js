const CITY_UTILITIES = {
  CLEARWATER: { water: 'City of Clearwater', sewer: 'City of Clearwater', electric: 'Duke Energy', source: 'municipal' },
  LARGO: { water: 'City of Largo', sewer: 'City of Largo', electric: 'Duke Energy', source: 'municipal' },
  DUNEDIN: { water: 'City of Dunedin', sewer: 'City of Dunedin', electric: 'Duke Energy', source: 'municipal' },
  'SAFETY HARBOR': { water: 'City of Safety Harbor', sewer: 'City of Safety Harbor', electric: 'Duke Energy', source: 'municipal' },
  SEMINOLE: { water: 'City of Seminole', sewer: 'City of Seminole', electric: 'Duke Energy', source: 'municipal' },
  TAMPA: { water: 'City of Tampa', sewer: 'City of Tampa', electric: 'TECO', source: 'municipal' },
  'TEMPLE TERRACE': { water: 'City of Temple Terrace', sewer: 'City of Temple Terrace', electric: 'TECO', source: 'municipal' },
  BRANDON: { water: 'Hillsborough County / Brandon', sewer: 'Hillsborough County', electric: 'TECO', source: 'county-municipal' },
  BRADENTON: { water: 'City of Bradenton', sewer: 'City of Bradenton', electric: 'FPL', source: 'municipal' },
  PALMETTO: { water: 'City of Palmetto', sewer: 'City of Palmetto', electric: 'FPL', source: 'municipal' },
  SARASOTA: { water: 'City of Sarasota', sewer: 'City of Sarasota', electric: 'FPL', source: 'municipal' },
  VENICE: { water: 'City of Venice', sewer: 'City of Venice', electric: 'FPL', source: 'municipal' },
  'NORTH PORT': { water: 'City of North Port', sewer: 'City of North Port', electric: 'FPL', source: 'municipal' },
  'NEW PORT RICHEY': { water: 'City of New Port Richey', sewer: 'City of New Port Richey', electric: 'Duke Energy', source: 'municipal' },
  'PORT RICHEY': { water: 'City of Port Richey', sewer: 'City of Port Richey', electric: 'Duke Energy', source: 'municipal' },
  HOLIDAY: { water: 'Pasco County Utilities', sewer: 'Septic typical', electric: 'Duke Energy', source: 'county' },
  HUDSON: { water: 'Pasco County Utilities / well', sewer: 'Septic typical', electric: 'Duke Energy', source: 'county' },
  PARRISH: { water: 'Manatee County / municipal', sewer: 'Septic / county sewer', electric: 'FPL', source: 'county' },
  'LAND O LAKES': { water: 'Pasco County Utilities / well', sewer: 'Septic typical', electric: 'Duke Energy', source: 'county' },
  'WESLEY CHAPEL': { water: 'Pasco County Utilities', sewer: 'Septic / county sewer', electric: 'Duke Energy', source: 'county' }
};

const COUNTY_DEFAULTS = {
  Pinellas: { water: 'Pinellas County / municipal', sewer: 'Municipal or septic', electric: 'Duke Energy', source: 'county' },
  Hillsborough: { water: 'Hillsborough County / municipal', sewer: 'County / municipal', electric: 'TECO', source: 'county' },
  Pasco: { water: 'Pasco County Utilities / private well', sewer: 'Septic typical (unincorporated)', electric: 'Duke Energy', source: 'county' },
  Manatee: { water: 'Manatee County / municipal', sewer: 'County / municipal / septic', electric: 'FPL', source: 'county' },
  Sarasota: { water: 'Sarasota County / municipal', sewer: 'County / municipal / septic', electric: 'FPL', source: 'county' }
};

function resolveUtilityProviders(lead = {}) {
  const city = (lead.city || '').trim().toUpperCase();
  const county = lead.county || '';
  const base = CITY_UTILITIES[city] || COUNTY_DEFAULTS[county] || {
    water: 'Unknown',
    sewer: 'Unknown',
    electric: 'FPL / Duke / TECO',
    source: 'unknown'
  };

  const existing = new Set((lead.utilities || []).map((u) => String(u).toLowerCase()));
  const providers = { ...base };

  if (lead.sewerProvider) providers.sewer = lead.sewerProvider;
  if (lead.waterProvider) providers.water = lead.waterProvider;
  if (lead.electricProvider) providers.electric = lead.electricProvider;

  const utilities = [];
  const sewerAvailable =
    existing.has('sewer') ||
    Boolean(lead.sewerProvider) ||
    (providers.sewer && !/septic typical|unknown/i.test(providers.sewer));
  const waterAvailable =
    existing.has('water') ||
    Boolean(lead.waterProvider) ||
    Boolean(providers.water && !/unknown/i.test(providers.water));
  const electricAvailable =
    existing.has('electric') ||
    Boolean(lead.electricProvider) ||
    Boolean(providers.electric);

  if (waterAvailable) utilities.push('water');
  if (sewerAvailable) utilities.push('sewer');
  if (electricAvailable) utilities.push('electric');

  const sewerType = /septic/i.test(providers.sewer) ? 'septic-likely' : sewerAvailable ? 'public' : 'unknown';
  const waterType = /well/i.test(providers.water) ? 'well-likely' : waterAvailable ? 'public' : 'unknown';

  return {
    utilities,
    waterProvider: providers.water,
    sewerProvider: providers.sewer,
    electricProvider: providers.electric,
    utilitySource: providers.source,
    sewerAvailable,
    waterAvailable,
    electricAvailable,
    sewerType,
    waterType,
    hasUtilities: utilities.length > 0
  };
}

module.exports = { CITY_UTILITIES, COUNTY_DEFAULTS, resolveUtilityProviders };