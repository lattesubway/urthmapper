#!/usr/bin/env node
/**
 * Export all leads to CSV
 * Usage: node export-leads-csv.js [--input clearwater-leads.json] [--output urthmapper-leads.csv]
 */

const fs = require('fs');

const COLUMNS = [
  ['id', 'ID'],
  ['parcelId', 'Parcel ID'],
  ['county', 'County'],
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
  const options = { input: 'clearwater-leads.json', output: 'urthmapper-leads.csv' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) options.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) options.output = argv[++i];
  }
  return options;
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

  const leads = JSON.parse(fs.readFileSync(options.input, 'utf8'));
  const header = COLUMNS.map(([, label]) => escapeCsv(label)).join(',');
  const rows = leads.map((lead) => COLUMNS.map(([key]) => escapeCsv(lead[key])).join(','));

  fs.writeFileSync(options.output, [header, ...rows].join('\n'));
  console.log(`✅ Exported ${leads.length} leads → ${options.output}`);
  console.log(`   Columns: ${COLUMNS.length}`);
}

main();