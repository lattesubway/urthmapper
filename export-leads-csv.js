#!/usr/bin/env node
/**
 * Export all leads to CSV
 * Usage: node export-leads-csv.js [--input clearwater-leads.json] [--output urthmapper-leads.csv]
 */

const fs = require('fs');

// Demo gate: only the 50 highest-scoring individual-owner leads are unlocked.
// Locked leads still export (parcel, owner, valuation, score) but their
// contact PII is withheld — mirroring the in-app lock in index.html.
const DEMO_UNLOCK_LIMIT = 50;
const CONTACT_KEYS = new Set([
  'phone', 'phones', 'email', 'emails', 'phoneType',
  'skiptraceSource', 'spokeoMatchType', 'skiptraceStatus',
]);

const COLUMNS = [
  ['id', 'ID'],
  ['parcelId', 'Parcel ID'],
  ['county', 'County'],
  ['isLocked', 'Locked'],
  ['owner', 'Owner'],
  ['ownerType', 'Owner Type'],
  ['situsAddress', 'Situs Address'],
  ['address', 'Street'],
  ['city', 'City'],
  ['state', 'State'],
  ['mailingAddress', 'Mailing Address'],
  ['mailState', 'Mail State'],
  ['isOOS', 'Out of State'],
  ['isAbsentee', 'Absentee'],
  ['phone', 'Phone'],
  ['phones', 'All Phones'],
  ['email', 'Email'],
  ['emails', 'All Emails'],
  ['isDNC', 'DNC'],
  ['phoneType', 'Phone Type'],
  ['skiptraceSource', 'Skiptrace Source'],
  ['spokeoMatchType', 'Spokeo Match'],
  ['skiptraceStatus', 'Skiptrace Status'],
  ['acreage', 'Acreage'],
  ['buildableAcres', 'Buildable Acres'],
  ['frontage', 'Frontage (ft)'],
  ['roadFrontage', 'Road Frontage'],
  ['frontageSource', 'Frontage Source'],
  ['lotDepthFt', 'Lot Depth (ft)'],
  ['frontageDepthRatio', 'Frontage:Depth'],
  ['zoning', 'Zoning'],
  ['zoningCategory', 'Zoning Category'],
  ['zoningDescription', 'Zoning Description'],
  ['allowsMobileHome', 'MH Allowed'],
  ['landUseLabel', 'Land Use'],
  ['dorCode', 'DOR Code'],
  ['floodZone', 'Flood Zone'],
  ['inSFHA', 'In SFHA'],
  ['elevationFt', 'Elevation (ft)'],
  ['waterAvailable', 'Water On-Site'],
  ['sewerAvailable', 'Sewer On-Site'],
  ['electricAvailable', 'Electric On-Site'],
  ['waterProvider', 'Water Provider'],
  ['sewerProvider', 'Sewer Provider'],
  ['electricProvider', 'Electric Provider'],
  ['sewerType', 'Sewer Type'],
  ['waterType', 'Water Type'],
  ['landValue', 'Land Value'],
  ['pricePerAcre', 'Price/Acre'],
  ['appraisalTotal', 'Appraisal Total'],
  ['assessedValue', 'Assessed Value'],
  ['marketValue', 'Market Value'],
  ['estAnnualTax', 'Est Annual Tax'],
  ['wholesaleOfferEst', 'Wholesale Est'],
  ['arv', 'ARV'],
  ['score', 'Appeal Score'],
  ['investorSignals', 'Investor Signals'],
  ['riskFlags', 'Risk Flags'],
  ['scoreBreakdown', 'Score Breakdown'],
  ['yrsOwned', 'Years Owned'],
  ['ownerParcelCount', 'Owner Parcel Count'],
  ['multiParcel', 'Multi Parcel Flag'],
  ['isPortfolioOwner', 'Portfolio Owner'],
  ['salePrice', 'Last Sale Price'],
  ['saleDate', 'Last Sale Date'],
  ['nearestRoad', 'Nearest Road'],
  ['roadAccess', 'Road Access'],
  ['legalAccess', 'Legal Access'],
  ['distToHighwayMi', 'Dist to Highway (mi)'],
  ['highwayName', 'Highway'],
  ['distHospitalMi', 'Dist Hospital (mi)'],
  ['distSchoolMi', 'Dist School (mi)'],
  ['distGroceryMi', 'Dist Grocery (mi)'],
  ['developmentPotential', 'Dev Potential'],
  ['estSubdivisionLots', 'Est Subdivision Lots'],
  ['waterFeatures', 'Water Features'],
  ['hasWetlandsNearby', 'Wetlands Nearby'],
  ['hasTaxDelinquency', 'Tax Delinquent'],
  ['hasLiens', 'Has Liens'],
  ['lat', 'Latitude'],
  ['lng', 'Longitude'],
  ['status', 'CRM Status'],
  ['favorite', 'Favorite'],
  ['dataSource', 'Data Source'],
  ['scrapedAt', 'Scraped At']
];

function parseArgs(argv) {
  // Default to the enriched master feed so unlocked leads carry real contact
  // data; locked leads have it stripped below.
  const options = { input: 'leads-data.js', output: 'urthmapper-leads.csv' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) options.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) options.output = argv[++i];
  }
  return options;
}

// Load leads from either a JSON array (clearwater-leads.json) or the
// leads-data.js bundle (a `const leadData = [...]` literal + init code).
function loadLeads(input) {
  const raw = fs.readFileSync(input, 'utf8');
  if (input.endsWith('.json')) return JSON.parse(raw);
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf('];');
  if (start === -1 || end === -1) throw new Error(`Could not find leadData array in ${input}`);
  return JSON.parse(raw.slice(start, end + 1));
}

// Returns a Set of the unlocked leads: the DEMO_UNLOCK_LIMIT highest-scoring
// individual-owner leads (stable tie-break by original order). Matches the
// runtime gate in index.html (loadRealLeads).
function selectUnlocked(leads) {
  return new Set(
    leads
      .map((lead, i) => ({ lead, i }))
      .filter(({ lead }) => lead.ownerType === 'Individual')
      .sort((a, b) => (b.lead.score - a.lead.score) || (a.i - b.i))
      .slice(0, DEMO_UNLOCK_LIMIT)
      .map(({ lead }) => lead)
  );
}

function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') {
    if (value.full) return value.full;
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && value > 1e11) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return String(value);
}

function escapeCsv(value) {
  const text = cellValue(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) {
    console.error(`❌ Input not found: ${options.input}`);
    process.exit(1);
  }

  const leads = loadLeads(options.input);
  const unlocked = selectUnlocked(leads);

  const header = COLUMNS.map(([, label]) => escapeCsv(label)).join(',');
  const rows = leads.map((lead) => {
    const isLocked = !unlocked.has(lead);
    return COLUMNS.map(([key]) => {
      if (key === 'isLocked') return escapeCsv(isLocked);
      if (isLocked && CONTACT_KEYS.has(key)) return escapeCsv(null);
      return escapeCsv(lead[key]);
    }).join(',');
  });

  fs.writeFileSync(options.output, [header, ...rows].join('\n'));
  const lockedCount = leads.length - unlocked.size;
  console.log(`✅ Exported ${leads.length} leads → ${options.output}`);
  console.log(`   Unlocked: ${unlocked.size} · Locked (contact withheld): ${lockedCount}`);
  console.log(`   Columns: ${COLUMNS.length}`);
}

main();