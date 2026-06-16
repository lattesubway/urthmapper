const NHD_BASE = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';

const FTYPE_LABELS = {
  336: 'canal',
  378: 'pond',
  390: 'lake/pond',
  436: 'lake/reservoir',
  460: 'stream/river',
  466: 'stream',
  458: 'estuary',
  493: 'bay/inlet',
  537: 'impoundment',
  SwampMarsh: 'swamp/marsh',
  LakePond: 'lake/pond',
  StreamRiver: 'stream/river',
  CanalDitch: 'canal/ditch',
  Estuary: 'estuary',
  BayInlet: 'bay/inlet',
  Reservoir: 'reservoir'
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function labelFromFtype(ftype) {
  if (ftype == null) return 'water feature';
  if (FTYPE_LABELS[ftype]) return FTYPE_LABELS[ftype];
  const key = String(ftype);
  if (FTYPE_LABELS[key]) return FTYPE_LABELS[key];
  return `water (${key})`;
}

async function queryNhdLayer(layerId, lat, lng, radiusMeters, outFields = '*') {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusMeters),
    units: 'esriSRUnit_Meter',
    outFields,
    returnGeometry: 'false',
    resultRecordCount: '25',
    f: 'json'
  });

  const response = await fetch(`${NHD_BASE}/${layerId}/query?${params}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.features || [];
}

function parseNhdFeatures(features, layerKind) {
  const labels = new Set();
  const named = [];

  for (const feature of features) {
    const a = feature.attributes || {};
    const ftype = a.FTYPE ?? a.ftype;
    const name = (a.GNIS_NAME || a.gnis_name || '').trim();
    const label = labelFromFtype(ftype);

    labels.add(label);
    if (name && name !== ' ') {
      named.push(`${label}: ${name}`);
    }
  }

  return {
    labels: [...labels],
    named: named.slice(0, 5),
    layerKind
  };
}

async function queryOverpass(lat, lng, radiusMeters) {
  const query = `[out:json][timeout:20];
(
  way["natural"~"water|wetland|coastline|bay|mangrove"](around:${radiusMeters},${lat},${lng});
  relation["natural"="water"](around:${radiusMeters},${lat},${lng});
  way["waterway"~"river|stream|canal|drain|ditch"](around:${radiusMeters},${lat},${lng});
);
out tags;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'urthmapper-lead-scraper/1.1' }
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) continue;
      const data = await response.json();
      const labels = new Set();

      for (const element of data.elements || []) {
        const tags = element.tags || {};
        if (tags.natural === 'water') labels.add('water body');
        if (tags.natural === 'wetland') labels.add('wetland');
        if (tags.natural === 'coastline' || tags.natural === 'bay') labels.add('coastal shoreline');
        if (tags.natural === 'mangrove') labels.add('mangrove');
        if (tags.waterway === 'river' || tags.waterway === 'stream') labels.add('stream/creek');
        if (tags.waterway === 'canal' || tags.waterway === 'drain' || tags.waterway === 'ditch') labels.add('canal/ditch');
        if (tags.water === 'pond' || tags.landuse === 'pond') labels.add('pond');
        if (tags.water === 'reservoir') labels.add('reservoir');
        if (tags.name) labels.add(tags.name);
      }

      return [...labels];
    } catch {
      continue;
    }
  }

  return [];
}

function coastalProximityLabel(lat, lng) {
  // Gulf Coast heuristic for Tampa Bay / Clearwater region
  if (lng > -82.35) return null;
  if (lat < 27.0 || lat > 28.6) return null;
  const coastalBand = lng < -82.72;
  const nearBay = lat > 27.6 && lat < 28.2 && lng > -82.85 && lng < -82.55;
  if (coastalBand) return 'near Gulf/coastal zone';
  if (nearBay) return 'near Tampa Bay estuary';
  return null;
}

async function getWaterFeatures(lat, lng, options = {}) {
  if (!lat || !lng) {
    return { features: [], sources: [], nearestTypes: [] };
  }

  const radius = options.radiusMeters || 1200;
  const features = new Set();
  const sources = new Set();
  const details = [];

  const [waterbodiesLarge, waterbodiesSmall, flowlines] = await Promise.all([
    queryNhdLayer(12, lat, lng, radius),
    queryNhdLayer(10, lat, lng, radius),
    queryNhdLayer(6, lat, lng, radius)
  ]);

  for (const result of [
    parseNhdFeatures(waterbodiesLarge, 'nhd-waterbody'),
    parseNhdFeatures(waterbodiesSmall, 'nhd-waterbody'),
    parseNhdFeatures(flowlines, 'nhd-flowline')
  ]) {
    if (result.labels.length) {
      sources.add('usgs-nhd');
      result.labels.forEach((l) => features.add(l));
      result.named.forEach((n) => details.push(n));
    }
  }

  const osm = await queryOverpass(lat, lng, radius);
  if (osm.length) {
    sources.add('openstreetmap');
    osm.forEach((f) => features.add(f));
  }

  const coastal = coastalProximityLabel(lat, lng);
  if (coastal) {
    sources.add('coastal-heuristic');
    features.add(coastal);
  }

  return {
    features: [...features].sort(),
    sources: [...sources],
    details: details.slice(0, 5),
    searchRadiusMeters: radius
  };
}

module.exports = {
  getWaterFeatures,
  labelFromFtype,
  coastalProximityLabel
};