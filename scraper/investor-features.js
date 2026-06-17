const { sleep } = require('./arcgis-client');
const { categorizeZoning } = require('./zoning-lookup');
const { resolveUtilityProviders } = require('./county-utilities');
const { refineFrontage, roadFrontageLabel } = require('./frontage');
const {
  estimateLotDepth,
  estimateShapeRegularity,
  estimateSubdivisionLots,
  estimateBuildableAcres
} = require('./geometry-metrics');

const USER_AGENT = 'urthmapper-lead-scraper/1.2';
const FL_MILLAGE_EST = 0.011;

const HIGHWAY_ANCHORS = [
  { name: 'I-75', lat: 27.498, lng: -82.432 },
  { name: 'I-75', lat: 28.02, lng: -82.45 },
  { name: 'I-275', lat: 27.77, lng: -82.64 },
  { name: 'I-275', lat: 27.91, lng: -82.68 },
  { name: 'I-4', lat: 27.95, lng: -82.45 },
  { name: 'US-19', lat: 28.02, lng: -82.77 },
  { name: 'US-19', lat: 27.72, lng: -82.74 },
  { name: 'US-41', lat: 27.34, lng: -82.53 },
  { name: 'US-301', lat: 27.85, lng: -82.32 }
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function haversineMi(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoCacheKey(lat, lng, precision = 2) {
  return `${Number(lat).toFixed(precision)},${Number(lng).toFixed(precision)}`;
}

function buildOwnerIndex(leads = []) {
  const index = new Map();
  for (const lead of leads) {
    const key = String(lead.owner || '').trim().toUpperCase();
    if (!key) continue;
    index.set(key, (index.get(key) || 0) + 1);
  }
  return index;
}

function computeFinancialMetrics(lead) {
  const acreage = lead.acreage || 0;
  const landValue = lead.landValue || 0;
  const assessed = lead.assessedValue || lead.marketValue || landValue;
  const improvementValue = Math.max(0, (lead.appraisalTotal || assessed) - landValue);
  const pricePerAcre = acreage > 0 ? Math.round(landValue / acreage) : null;
  const assessedPerAcre = acreage > 0 ? Math.round(assessed / acreage) : null;
  const estAnnualTax = Math.round(assessed * FL_MILLAGE_EST);
  const wholesaleOfferEst = Math.round(landValue * 0.35);
  const retailArvPerAcre = acreage > 0 && lead.arv ? Math.round(lead.arv / acreage) : null;

  let equityVsSalePct = null;
  if (lead.salePrice > 0 && landValue > 0) {
    equityVsSalePct = Math.round(((landValue - lead.salePrice) / lead.salePrice) * 100);
  }

  return {
    pricePerAcre,
    assessedPerAcre,
    improvementValue,
    estAnnualTax,
    wholesaleOfferEst,
    retailArvPerAcre,
    equityVsSalePct
  };
}

function computeUtilityFlags(lead) {
  return resolveUtilityProviders(lead);
}

function deriveEnvironmentalFlags(lead) {
  const water = lead.waterFeatures || [];
  const wetlandTerms = ['wetland', 'swamp', 'marsh', 'mangrove'];
  const hasWetlandsNearby = water.some((f) => wetlandTerms.some((t) => String(f).toLowerCase().includes(t)));
  const coastalTerms = ['coastal', 'gulf', 'bay', 'estuary', 'shoreline'];
  const coastalProximity = water.find((f) => coastalTerms.some((t) => String(f).toLowerCase().includes(t))) || null;
  const inSFHA = lead.floodZone === 'AE' || lead.floodZone === 'A' || lead.floodZone === 'VE';

  return { hasWetlandsNearby, coastalProximity, inSFHA };
}

function assessDevelopmentPotential(lead, extras = {}) {
  const signals = [];
  const risks = [];

  if (extras.estSubdivisionLots >= 2) signals.push(`${extras.estSubdivisionLots} potential lots`);
  if (extras.zoningAllowsMH) signals.push('MH-friendly zoning');
  if (lead.frontage >= 100) signals.push('Strong road frontage');
  if (extras.pricePerAcre && extras.pricePerAcre <= 15000) signals.push('Low $/acre');
  if (lead.isOOS || lead.isAbsentee) signals.push('Motivated owner profile');
  if (extras.ownerParcelCount >= 3) signals.push('Portfolio seller');

  if (lead.floodZone === 'AE') risks.push('100-year floodplain (AE)');
  if (extras.hasWetlandsNearby) risks.push('Wetlands nearby');
  if (!extras.nearestRoad) risks.push('Road access unverified');
  if (lead.hasTaxDelinquency) risks.push('Tax delinquency reported');
  if (extras.legalAccess === 'Unlikely') risks.push('Possible landlocked parcel');

  let developmentPotential = 'Low';
  const score = signals.length * 2 - risks.length * 2 + (lead.frontage >= 50 ? 1 : 0);
  if (score >= 5) developmentPotential = 'High';
  else if (score >= 2) developmentPotential = 'Medium';

  return { developmentPotential, investorSignals: signals, riskFlags: risks };
}

function nearestHighwayMi(lat, lng) {
  let best = { name: null, distanceMi: null };
  for (const anchor of HIGHWAY_ANCHORS) {
    const d = haversineMi(lat, lng, anchor.lat, anchor.lng);
    if (best.distanceMi == null || d < best.distanceMi) {
      best = { name: anchor.name, distanceMi: Math.round(d * 10) / 10 };
    }
  }
  return best;
}

function distBeachMi(lat, lng) {
  const gulfCoastLng = -82.85;
  const approxLngDist = Math.abs(lng - gulfCoastLng) * 69 * Math.cos((lat * Math.PI) / 180);
  return lng < -82.55 ? Math.round(approxLngDist * 10) / 10 : null;
}

async function getElevation(lat, lng) {
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    const data = await response.json();
    return data.value != null ? Math.round(data.value) : null;
  } catch {
    return null;
  }
}

async function getRoadContext(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=16`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    const data = await response.json();
    const road = data.address?.road || data.address?.pedestrian || data.address?.footway || null;
    const roadClass = data.class || data.address?.road_type || null;
    const suburb = data.address?.suburb || data.address?.neighbourhood || data.address?.city || null;

    return {
      nearestRoad: road,
      roadClass,
      suburb,
      legalAccess: road ? 'Confirmed' : 'Unknown'
    };
  } catch {
    return null;
  }
}

async function queryOverpassAmenities(lat, lng) {
  const query = `[out:json][timeout:8];
(
  node["amenity"="hospital"](around:20000,${lat},${lng});
  node["amenity"="school"](around:12000,${lat},${lng});
  node["amenity"="fire_station"](around:12000,${lat},${lng});
  node["shop"="supermarket"](around:12000,${lat},${lng});
);
out center 8;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) continue;
      const data = await response.json();

      const nearest = { hospital: null, school: null, grocery: null, fire: null };
      for (const el of data.elements || []) {
        const tags = el.tags || {};
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (elLat == null || elLng == null) continue;
        const dist = haversineMi(lat, lng, elLat, elLng);
        const kind =
          tags.amenity === 'hospital' ? 'hospital'
            : tags.amenity === 'school' ? 'school'
              : tags.amenity === 'fire_station' ? 'fire'
                : tags.shop === 'supermarket' ? 'grocery'
                  : null;
        if (!kind) continue;
        if (nearest[kind] == null || dist < nearest[kind]) nearest[kind] = Math.round(dist * 10) / 10;
      }
      return nearest;
    } catch {
      continue;
    }
  }
  return null;
}

async function getGeoContext(lat, lng, cache) {
  const key = geoCacheKey(lat, lng);
  if (cache.geo.has(key)) return cache.geo.get(key);

  const elevationFt = await getElevation(lat, lng);
  const road = await getRoadContext(lat, lng);
  await sleep(1100);
  const amenities = await queryOverpassAmenities(lat, lng);

  const highway = nearestHighwayMi(lat, lng);
  const result = {
    elevationFt,
    nearestRoad: road?.nearestRoad || null,
    roadClass: road?.roadClass || null,
    suburb: road?.suburb || null,
    legalAccess: road?.legalAccess || 'Unknown',
    distToHighwayMi: highway.distanceMi,
    highwayName: highway.name,
    distHospitalMi: amenities?.hospital ?? null,
    distSchoolMi: amenities?.school ?? null,
    distGroceryMi: amenities?.grocery ?? null,
    distFireMi: amenities?.fire ?? null,
    distBeachMi: distBeachMi(lat, lng)
  };

  cache.geo.set(key, result);
  return result;
}

function refineParcelFields(lead) {
  const frontageData = refineFrontage(lead);
  const utilities = computeUtilityFlags({ ...lead, utilities: lead.utilities });
  const zoning = categorizeZoning(lead.zoning, lead.dorCode, {
    county: lead.county,
    landUseDescription: lead.landUseDescription
  });

  return {
    ...frontageData,
    ...utilities,
    zoningCategory: zoning.category,
    zoningDescription: zoning.description,
    zoningSource: zoning.zoningSource,
    landUseLabel: zoning.landUseLabel || null,
    allowsMobileHome: zoning.allowsMH,
    minLotWidthFt: zoning.minLotWidth,
    roadFrontage: roadFrontageLabel({ ...lead, ...frontageData })
  };
}

function enrichInvestorFeaturesLocal(lead, ownerIndex) {
  const parcel = refineParcelFields(lead);
  const merged = { ...lead, ...parcel };

  const financial = computeFinancialMetrics(merged);
  const utilities = computeUtilityFlags(merged);
  const env = deriveEnvironmentalFlags(merged);
  const zoning = categorizeZoning(merged.zoning, merged.dorCode, {
    county: merged.county,
    landUseDescription: merged.landUseDescription
  });

  const lotDepthFt = estimateLotDepth(merged.acreage, merged.frontage);
  const shapeRegularity = estimateShapeRegularity(merged.acreage, merged.frontage, lotDepthFt);
  const estSubdivisionLots = estimateSubdivisionLots(merged.frontage, lotDepthFt, zoning.minLotWidth);
  const buildableAcres = estimateBuildableAcres(merged.acreage, { ...env, floodZone: merged.floodZone });

  const ownerKey = String(merged.owner || '').trim().toUpperCase();
  const ownerParcelCount = ownerIndex.get(ownerKey) || 1;
  const isPortfolioOwner = ownerParcelCount >= 2;

  const assessment = assessDevelopmentPotential(merged, {
    estSubdivisionLots,
    zoningAllowsMH: zoning.allowsMH,
    pricePerAcre: financial.pricePerAcre,
    ownerParcelCount,
    hasWetlandsNearby: env.hasWetlandsNearby,
    nearestRoad: merged.nearestRoad,
    legalAccess: merged.legalAccess
  });

  return {
    ...parcel,
    ...financial,
    lotDepthFt,
    frontageDepthRatio: lotDepthFt > 0 ? Math.round((merged.frontage / lotDepthFt) * 100) / 100 : null,
    shapeRegularity,
    estSubdivisionLots,
    buildableAcres,
    ownerParcelCount,
    isPortfolioOwner,
    multiParcel: ownerParcelCount,
    zoningCategory: zoning.category,
    zoningDescription: zoning.description,
    zoningSource: zoning.zoningSource,
    landUseLabel: zoning.landUseLabel || parcel.landUseLabel,
    allowsMobileHome: zoning.allowsMH,
    minLotWidthFt: zoning.minLotWidth,
    ...utilities,
    ...env,
    ...assessment,
    roadAccess: merged.frontage >= 100 ? 'Excellent' : merged.frontage >= 50 ? 'Good' : merged.frontage > 0 ? 'Fair' : 'Unknown'
  };
}

async function enrichInvestorFeatures(lead, { ownerIndex, cache, fetchGeo = true } = {}) {
  const local = enrichInvestorFeaturesLocal(lead, ownerIndex);

  if (!fetchGeo || !lead.lat || !lead.lng) {
    return { ...lead, ...local };
  }

  const geo = await getGeoContext(lead.lat, lead.lng, cache);
  const merged = { ...lead, ...local, ...geo };

  const reassessed = assessDevelopmentPotential(merged, {
    estSubdivisionLots: merged.estSubdivisionLots,
    zoningAllowsMH: merged.allowsMobileHome,
    pricePerAcre: merged.pricePerAcre,
    ownerParcelCount: merged.ownerParcelCount,
    hasWetlandsNearby: merged.hasWetlandsNearby,
    nearestRoad: merged.nearestRoad,
    legalAccess: merged.legalAccess
  });

  return { ...merged, ...reassessed };
}

function createGeoCache() {
  return { geo: new Map() };
}

module.exports = {
  buildOwnerIndex,
  enrichInvestorFeatures,
  enrichInvestorFeaturesLocal,
  refineParcelFields,
  createGeoCache,
  computeFinancialMetrics,
  geoCacheKey
};