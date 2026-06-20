const fs = require('fs');

const GEOJSON_PROPS = [
  'id', 'parcelId', 'county', 'owner', 'ownerType', 'address', 'city', 'state',
  'situsAddress', 'mailingAddress', 'mailState', 'isOOS', 'isAbsentee',
  'phone', 'email', 'acreage', 'zoning', 'landUseLabel', 'dorCode',
  'landValue', 'assessedValue', 'marketValue', 'arv', 'floodZone',
  'hasUtilities', 'frontage', 'saleDate', 'salePrice',
  'investorSignals', 'riskFlags', 'score', 'status', 'lat', 'lng',
  'dataSource', 'scrapedAt'
];

const CSV_COLUMNS = [
  'id', 'parcelId', 'county', 'owner', 'ownerType', 'address', 'city', 'state',
  'situsAddress', 'mailingAddress', 'mailState', 'isOOS', 'isAbsentee',
  'phone', 'email', 'acreage', 'zoning', 'landUseLabel', 'dorCode',
  'landValue', 'assessedValue', 'marketValue', 'arv', 'floodZone',
  'hasUtilities', 'frontage', 'saleDate', 'salePrice',
  'score', 'status', 'lat', 'lng', 'dataSource', 'scrapedAt'
];

function esriGeometryToGeoJSON(geometry) {
  if (!geometry) return null;

  if (geometry.x != null && geometry.y != null) {
    return { type: 'Point', coordinates: [geometry.x, geometry.y] };
  }

  const rings = geometry.rings;
  if (Array.isArray(rings) && rings.length) {
    if (rings.length === 1) {
      return { type: 'Polygon', coordinates: rings };
    }
    return { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) };
  }

  return null;
}

function pickProps(lead, keys) {
  const out = {};
  for (const key of keys) {
    let value = lead[key];
    if (Array.isArray(value)) value = value.join('; ');
    out[key] = value == null ? '' : value;
  }
  return out;
}

function writeGeoJSON(leads, geometryByParcel, filename) {
  const features = leads
    .map((lead) => {
      const geometry =
        esriGeometryToGeoJSON(geometryByParcel.get(lead.parcelId)) ||
        (lead.lat != null && lead.lng != null
          ? { type: 'Point', coordinates: [lead.lng, lead.lat] }
          : null);
      if (!geometry) return null;
      return { type: 'Feature', geometry, properties: pickProps(lead, GEOJSON_PROPS) };
    })
    .filter(Boolean);

  const featureCollection = { type: 'FeatureCollection', features };
  fs.writeFileSync(filename, JSON.stringify(featureCollection));
  return features.length;
}

function csvEscape(value) {
  if (value == null) return '';
  let str = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCSV(leads, filename) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const lead of leads) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(lead[col])).join(','));
  }
  fs.writeFileSync(filename, lines.join('\n'));
  return leads.length;
}

function buildSummary(leads) {
  const total = leads.length;
  const oos = leads.filter((l) => l.isOOS).length;
  const absentee = leads.filter((l) => l.isAbsentee).length;
  const withPhone = leads.filter((l) => l.phone).length;
  const withEmail = leads.filter((l) => l.email).length;

  const ownerTypes = {};
  const cities = {};
  let acreageSum = 0;
  let scoreSum = 0;
  for (const l of leads) {
    ownerTypes[l.ownerType] = (ownerTypes[l.ownerType] || 0) + 1;
    if (l.city) cities[l.city] = (cities[l.city] || 0) + 1;
    acreageSum += l.acreage || 0;
    scoreSum += l.score || 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalLeads: total,
    avgScore: total ? Math.round(scoreSum / total) : 0,
    outOfStateOwners: oos,
    absenteeOwners: absentee,
    absenteePct: total ? Math.round(((oos + absentee) / total) * 100) : 0,
    withPhone,
    withEmail,
    avgAcreage: total ? Math.round((acreageSum / total) * 100) / 100 : 0,
    ownerTypes,
    cities,
    topLeads: leads.slice(0, 10).map((l) => ({
      parcelId: l.parcelId,
      owner: l.owner,
      city: l.city,
      acreage: l.acreage,
      landValue: l.landValue,
      score: l.score
    }))
  };
}

function writeSummary(leads, filename) {
  const summary = buildSummary(leads);

  if (filename.endsWith('.json')) {
    fs.writeFileSync(filename, JSON.stringify(summary, null, 2));
    return summary;
  }

  const ownerTypeLines = Object.entries(summary.ownerTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `- ${type}: ${count}`)
    .join('\n');

  const cityLines = Object.entries(summary.cities)
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => `- ${city}: ${count}`)
    .join('\n');

  const topLines = summary.topLeads
    .map(
      (l, i) =>
        `${i + 1}. ${l.owner} — ${l.city} — ${l.acreage} ac — $${l.landValue.toLocaleString()} — score ${l.score}`
    )
    .join('\n');

  const md = `# Pinellas / Clearwater Vacant Land Lead Summary

Generated: ${summary.generatedAt}

## Totals
- Total qualified leads: ${summary.totalLeads}
- Average lead score: ${summary.avgScore}/100
- Average acreage: ${summary.avgAcreage}
- Out-of-state owners: ${summary.outOfStateOwners}
- Absentee owners: ${summary.absenteeOwners}
- Absentee/OOS share: ${summary.absenteePct}%
- Leads with phone: ${summary.withPhone}
- Leads with email: ${summary.withEmail}

## Owner Types
${ownerTypeLines || '- (none)'}

## Cities
${cityLines || '- (none)'}

## Top 10 Leads
${topLines || '- (none)'}
`;

  fs.writeFileSync(filename, md);
  return summary;
}

module.exports = { writeGeoJSON, writeCSV, writeSummary, buildSummary, esriGeometryToGeoJSON };
