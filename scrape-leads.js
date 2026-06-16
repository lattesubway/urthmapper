#!/usr/bin/env node
/**
 * Urthmapper — Real vacant land lead scraper
 * Pulls live parcel data from county ArcGIS services (Clearwater + surrounding counties)
 * Enriches with FEMA flood zones, OSM water features, and optional paid skiptrace
 *
 * Usage:
 *   node scrape-leads.js
 *   node scrape-leads.js --county pinellas --limit 100
 *   node scrape-leads.js --skiptrace --export-app
 *
 * Skiptrace (Spokeo Business API + optional proxy):
 *   export CONTACT_PROVIDER=spokeo
 *   export SPOKEO_API_KEY=your_key
 *   export SPOKEO_PROXY_URL=http://user:pass@host:port   # optional
 */

const fs = require('fs');
const path = require('path');

const { queryAllFeatures } = require('./scraper/arcgis-client');
const { COUNTY_SOURCES } = require('./scraper/counties');
const { createSkiptraceProvider, enrichParcel } = require('./scraper/enrichment');
const { scoreLead, passesInvestorFilters } = require('./scraper/scoring');

const DEFAULT_FILTERS = {
  minLandValue: 5000,
  maxLandValue: 250000,
  minAcres: 0.15,
  maxAcres: 20,
  minScore: 35,
  requireMotivatedOwner: true
};

function parseArgs(argv) {
  const options = {
    counties: Object.keys(COUNTY_SOURCES),
    limitPerCounty: 150,
    output: 'clearwater-leads.json',
    exportApp: false,
    skiptrace: false,
    enrichFlood: true,
    enrichWater: true,
    minScore: DEFAULT_FILTERS.minScore,
    allOwners: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--county' && argv[i + 1]) {
      options.counties = [argv[++i].toLowerCase()];
    } else if (arg === '--limit' && argv[i + 1]) {
      options.limitPerCounty = Number(argv[++i]);
    } else if (arg === '--output' && argv[i + 1]) {
      options.output = argv[++i];
    } else if (arg === '--min-score' && argv[i + 1]) {
      options.minScore = Number(argv[++i]);
    } else if (arg === '--export-app') {
      options.exportApp = true;
    } else if (arg === '--skiptrace') {
      options.skiptrace = true;
    } else if (arg === '--no-flood') {
      options.enrichFlood = false;
    } else if (arg === '--no-water') {
      options.enrichWater = false;
    } else if (arg === '--all-owners') {
      options.allOwners = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Urthmapper Lead Scraper — live county GIS data

Options:
  --county NAME       pinellas|hillsborough|pasco|manatee|sarasota (default: all)
  --limit N           Max parcels per county before filtering (default: 150)
  --min-score N       Minimum investor score to keep (default: 35)
  --output FILE       JSON output path (default: clearwater-leads.json)
  --export-app        Also write leads-data.js for the map UI
  --skiptrace         Enrich with CONTACT_PROVIDER + CONTACT_API_KEY
  --all-owners        Include local owners (default: motivated/absentee/OOS/entity)
  --no-flood          Skip FEMA flood zone lookups
  --no-water          Skip OSM water feature lookups

Skiptrace env vars (Spokeo recommended):
  CONTACT_PROVIDER=spokeo
  SPOKEO_API_KEY=your_spokeo_business_api_key
  SPOKEO_PROXY_URL=http://user:pass@proxy:port   # optional
  SPOKEO_DELAY_MS=600                            # optional

Or: CONTACT_PROVIDER=reishub|peopledatalabs + CONTACT_API_KEY

Examples:
  node scrape-leads.js
  node scrape-leads.js --county pinellas --limit 200 --export-app
  CONTACT_PROVIDER=reishub CONTACT_API_KEY=xxx node scrape-leads.js --skiptrace
`);
}

async function fetchCountyParcels(countyKey, filters, limitPerCounty) {
  const sourceKey = Object.keys(COUNTY_SOURCES).find(
    (k) => k.toLowerCase() === countyKey.toLowerCase()
  );
  if (!sourceKey) throw new Error(`Unknown county: ${countyKey}`);

  const source = COUNTY_SOURCES[sourceKey];
  const where = source.buildWhere(filters);

  console.log(`\n📍 ${source.name}: querying county GIS...`);
  console.log(`   WHERE ${where.slice(0, 120)}${where.length > 120 ? '...' : ''}`);

  const features = await queryAllFeatures(
    {
      url: source.queryUrl,
      where,
      outFields: '*',
      returnGeometry: true,
      outSR: 4326
    },
    { maxRecords: limitPerCounty, pageSize: 250, delayMs: 300 }
  );

  let parcels = features.map((feature) => source.parseFeature(feature));
  if (source.postFilter) {
    parcels = parcels.filter((parcel) => source.postFilter(parcel));
  }

  console.log(`   ✓ ${features.length} raw parcels → ${parcels.length} in target cities`);
  return parcels;
}

function toAppLead(parcel, id) {
  const appraisalTotal = (parcel.landValue || 0) + (parcel.improvementValue || 0);

  return {
    id,
    parcelId: parcel.parcelId,
    county: parcel.county,

    address: parcel.situsAddress?.street || '',
    city: parcel.situsAddress?.city || '',
    state: (parcel.situsAddress?.state || 'FL').trim(),
    situsAddress: parcel.situsAddress?.full || '',
    mailingAddress: parcel.mailingAddress?.full || '',

    owner: parcel.owner,
    ownerType: parcel.ownerType,
    mailState: parcel.mailState,
    isOOS: parcel.isOOS,
    isAbsentee: parcel.isAbsentee,

    phone: parcel.phone || null,
    email: parcel.email || null,
    skiptraceSource: parcel.skiptraceSource || null,
    spokeoId: parcel.spokeoId || null,
    spokeoMatchType: parcel.spokeoMatchType || null,
    isDNC: parcel.isDNC || false,

    acreage: Math.round((parcel.acreage || 0) * 100) / 100,
    zoning: parcel.zoning || 'Unknown',
    landUseLabel: parcel.landUseLabel || null,
    zoningSource: parcel.zoningSource || null,
    frontage: Math.round(parcel.frontage || 0),
    frontageSource: parcel.frontageSource || null,
    roadFrontage: parcel.roadFrontage || null,
    floodZone: parcel.floodZone || 'Unknown',
    waterFeatures: parcel.waterFeatures || [],
    waterFeatureSources: parcel.waterFeatureSources || [],
    waterFeatureDetails: parcel.waterFeatureDetails || [],

    landValue: Math.round(parcel.landValue || 0),
    appraisalTotal: Math.round(appraisalTotal),
    assessedValue: Math.round(parcel.marketValue || appraisalTotal),
    marketValue: Math.round(parcel.marketValue || appraisalTotal),
    arv: Math.round((parcel.marketValue || appraisalTotal) * 1.15),

    hasUtilities: parcel.hasUtilities || false,
    utilities: parcel.utilities || [],
    waterProvider: parcel.waterProvider || null,
    sewerProvider: parcel.sewerProvider || null,
    electricProvider: parcel.electricProvider || null,
    utilitySource: parcel.utilitySource || null,
    sewerType: parcel.sewerType || null,
    waterType: parcel.waterType || null,
    hasLiens: parcel.hasLiens || false,
    hasTaxDelinquency: parcel.hasTaxDelinquency || false,
    roadAccess: parcel.roadAccess || 'Unknown',

    yrsOwned: parcel.yrsOwned || 0,
    multiParcel: parcel.multiParcel || parcel.ownerParcelCount || 1,
    ownerParcelCount: parcel.ownerParcelCount || 1,
    isPortfolioOwner: parcel.isPortfolioOwner || false,
    pricePerAcre: parcel.pricePerAcre || null,
    lotDepthFt: parcel.lotDepthFt || null,
    estSubdivisionLots: parcel.estSubdivisionLots || 0,
    buildableAcres: parcel.buildableAcres || null,
    estAnnualTax: parcel.estAnnualTax || null,
    wholesaleOfferEst: parcel.wholesaleOfferEst || null,
    equityVsSalePct: parcel.equityVsSalePct || null,
    elevationFt: parcel.elevationFt || null,
    nearestRoad: parcel.nearestRoad || null,
    distToHighwayMi: parcel.distToHighwayMi || null,
    highwayName: parcel.highwayName || null,
    distHospitalMi: parcel.distHospitalMi || null,
    distSchoolMi: parcel.distSchoolMi || null,
    distGroceryMi: parcel.distGroceryMi || null,
    distBeachMi: parcel.distBeachMi || null,
    zoningCategory: parcel.zoningCategory || null,
    zoningDescription: parcel.zoningDescription || null,
    allowsMobileHome: parcel.allowsMobileHome || false,
    sewerAvailable: parcel.sewerAvailable || false,
    waterAvailable: parcel.waterAvailable || false,
    electricAvailable: parcel.electricAvailable || false,
    broadbandLikely: parcel.broadbandLikely || false,
    hasWetlandsNearby: parcel.hasWetlandsNearby || false,
    inSFHA: parcel.inSFHA || false,
    developmentPotential: parcel.developmentPotential || null,
    investorSignals: parcel.investorSignals || [],
    riskFlags: parcel.riskFlags || [],
    dorCode: parcel.dorCode || '',
    landUseDescription: parcel.landUseDescription || '',
    saleDate: parcel.saleDate || null,
    salePrice: parcel.salePrice || null,

    score: parcel.score,
    scoreBreakdown: parcel.scoreBreakdown || [],
    comparables: 0,
    status: 'New',
    favorite: false,
    lat: parcel.lat,
    lng: parcel.lng,
    dataSource: parcel.sourceLayer,
    scrapedAt: new Date().toISOString()
  };
}

function saveJson(leads, filename) {
  fs.writeFileSync(filename, JSON.stringify(leads, null, 2));
  console.log(`\n✅ Saved ${leads.length} leads → ${filename}`);
}

function exportForApp(leads, filename = 'leads-data.js') {
  const code = `// Auto-generated by scrape-leads.js
// Generated: ${new Date().toISOString()}
// Source: Live county GIS + FEMA + OSM enrichment

const leadData = ${JSON.stringify(leads, null, 2)};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof prospects !== 'undefined') {
    prospects = leadData;
    if (typeof loadSaved === 'function') loadSaved();
    if (typeof buildLeadFilters === 'function') buildLeadFilters();
    if (typeof loadParcelBoundaries === 'function') loadParcelBoundaries(prospects);
    console.log(\`Loaded \${leadData.length} scraped leads\`);
  }
});
`;
  fs.writeFileSync(filename, code);
  console.log(`✅ Wrote ${filename} for map integration`);
}

function printReport(leads) {
  if (!leads.length) {
    console.log('\n❌ No leads matched investor criteria.');
    return;
  }

  const avgScore = Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length);
  const withPhone = leads.filter((l) => l.phone).length;
  const oos = leads.filter((l) => l.isOOS).length;
  const absentee = leads.filter((l) => l.isAbsentee).length;

  console.log('\n' + '='.repeat(72));
  console.log('📊 SCRAPE REPORT — LIVE COUNTY DATA');
  console.log('='.repeat(72));
  console.log(`Total qualified leads: ${leads.length}`);
  console.log(`Average score:         ${avgScore}/100`);
  console.log(`Out-of-state owners:   ${oos}`);
  console.log(`Absentee owners:       ${absentee}`);
  console.log(`With skiptrace phone:  ${withPhone}${withPhone ? '' : ' (set CONTACT_API_KEY + --skiptrace)'}`);
  console.log('='.repeat(72));
  console.log('\n🌟 TOP 10:\n');
  leads.slice(0, 10).forEach((lead, i) => {
    const contact = lead.phone ? ` | ${lead.phone}` : '';
    console.log(
      `${String(i + 1).padStart(2)}. ${lead.owner.slice(0, 32).padEnd(32)} | ${lead.county.padEnd(12)} | Score ${String(lead.score).padStart(3)} | $${String(lead.landValue).padStart(7)}${contact}`
    );
  });
  console.log('');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const filters = {
    ...DEFAULT_FILTERS,
    minScore: options.minScore,
    requireMotivatedOwner: !options.allOwners
  };

  const skiptrace = options.skiptrace ? createSkiptraceProvider() : null;
  if (options.skiptrace && !skiptrace) {
    console.warn('⚠️  --skiptrace set but CONTACT_PROVIDER/CONTACT_API_KEY missing. Continuing without phone/email enrichment.');
  }

  const countyKeys = options.counties.map((c) => {
    const match = Object.keys(COUNTY_SOURCES).find((k) => k.toLowerCase() === c.toLowerCase());
    if (!match) throw new Error(`Unknown county: ${c}`);
    return match;
  });

  const rawParcels = [];
  for (const countyKey of countyKeys) {
    try {
      const parcels = await fetchCountyParcels(countyKey, filters, options.limitPerCounty);
      rawParcels.push(...parcels);
    } catch (error) {
      console.error(`❌ ${countyKey} failed: ${error.message}`);
    }
  }

  console.log(`\n🔬 Enriching ${rawParcels.length} parcels (flood, water, scoring${skiptrace ? ', skiptrace' : ''})...`);

  const enriched = [];
  for (let i = 0; i < rawParcels.length; i += 1) {
    const parcel = rawParcels[i];
    process.stdout.write(`\r   Processing ${i + 1}/${rawParcels.length}...`);

    try {
      const full = await enrichParcel(parcel, {
        skiptrace,
        enrichFlood: options.enrichFlood,
        enrichWater: options.enrichWater
      });

      const { score, breakdown } = scoreLead(full);
      full.score = score;
      full.scoreBreakdown = breakdown;

      if (passesInvestorFilters(full, filters)) {
        enriched.push(full);
      }
    } catch (error) {
      console.warn(`\n   ⚠️  ${parcel.parcelId}: ${error.message}`);
    }
  }
  process.stdout.write('\n');

  enriched.sort((a, b) => b.score - a.score || a.landValue - b.landValue);
  const leads = enriched.map((parcel, index) => toAppLead(parcel, index + 1));

  printReport(leads);
  saveJson(leads, path.resolve(options.output));
  if (options.exportApp) exportForApp(leads);

  console.log('\nNext: refresh http://localhost:8888 or run with --export-app');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Scrape failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main, fetchCountyParcels, toAppLead };