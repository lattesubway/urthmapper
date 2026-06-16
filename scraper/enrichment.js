const { sleep } = require('./arcgis-client');
const { getWaterFeatures: getWaterFeaturesDetailed } = require('./water-features');
const { createSkiptraceProvider } = require('./skiptrace');

function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let sumX = 0;
  let sumY = 0;
  const count = ring.length - 1;
  for (let i = 0; i < count; i += 1) {
    sumX += ring[i][0];
    sumY += ring[i][1];
  }
  return { lng: sumX / count, lat: sumY / count };
}

function getCentroid(geometry) {
  if (!geometry) return null;

  if (geometry.x != null && geometry.y != null) {
    return { lng: geometry.x, lat: geometry.y };
  }

  const rings = geometry.rings || geometry.coordinates;
  if (!rings || !rings.length) return null;

  const ring = Array.isArray(rings[0][0]) ? rings[0] : rings;
  return ringCentroid(ring);
}

function segmentLengthFeet(p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const meters = Math.sqrt(dx * dx + dy * dy);
  return meters * 3.28084;
}

function estimateFrontageFromGeometry(geometry) {
  if (!geometry?.rings?.[0]) return 0;
  const ring = geometry.rings[0];
  const edges = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    edges.push(segmentLengthFeet(ring[i], ring[i + 1]));
  }
  if (!edges.length) return 0;
  edges.sort((a, b) => b - a);
  return Math.round(edges[0]);
}

function normalizeFloodZone(zone = '') {
  const value = String(zone).trim().toUpperCase();
  if (!value || value === 'NONE') return 'None';
  if (value === 'X' || value.startsWith('X')) return 'X';
  if (value.includes('AE') || value === 'A') return 'AE';
  return value;
}

async function getFloodZone(lat, lng) {
  if (!lat || !lng) return 'Unknown';

  try {
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'FLD_ZONE,ZONE_SUBTY',
      returnGeometry: 'false',
      f: 'json'
    });

    const response = await fetch(
      `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${params}`
    );
    if (!response.ok) return 'Unknown';
    const data = await response.json();
    const zone = data.features?.[0]?.attributes?.FLD_ZONE;
    return normalizeFloodZone(zone);
  } catch {
    return 'Unknown';
  }
}

async function getWaterFeatures(lat, lng, options = {}) {
  const result = await getWaterFeaturesDetailed(lat, lng, options);
  return result.features || [];
}

function yearsOwned(saleDate) {
  if (!saleDate) return null;
  const parsed = typeof saleDate === 'number' ? new Date(saleDate) : new Date(saleDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const years = (Date.now() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

function ownerSignals(parcel) {
  const mailState = (parcel.mailingAddress?.state || '').trim().toUpperCase();
  const situsState = (parcel.situsAddress?.state || 'FL').trim().toUpperCase();
  const mailCity = (parcel.mailingAddress?.city || '').trim().toUpperCase();
  const situsCity = (parcel.situsAddress?.city || '').trim().toUpperCase();

  const isOOS = Boolean(mailState && mailState !== 'FL' && mailState !== situsState);
  const isAbsentee = !isOOS && mailState === 'FL' && mailCity && situsCity && mailCity !== situsCity;
  const isEntity = ['LLC', 'Trust', 'Estate', 'Corporate', 'Heirs'].includes(parcel.ownerType);

  return { isOOS, isAbsentee, isEntity, mailState: mailState || null };
}

async function enrichParcel(parcel, { skiptrace = null, enrichFlood = true, enrichWater = true } = {}) {
  const centroid = getCentroid(parcel.geometry);
  const lat = centroid?.lat || null;
  const lng = centroid?.lng || null;

  if (!parcel.frontage && parcel.geometry) {
    parcel.frontage = estimateFrontageFromGeometry(parcel.geometry);
  }

  const signals = ownerSignals(parcel);
  const yrsOwned = yearsOwned(parcel.saleDate);

  let floodZone = 'Unknown';
  if (enrichFlood && lat && lng) {
    floodZone = await getFloodZone(lat, lng);
    await sleep(100);
  }

  let waterFeatures = [];
  let waterFeatureSources = [];
  let waterFeatureDetails = [];
  if (enrichWater && lat && lng) {
    const water = await getWaterFeaturesDetailed(lat, lng);
    waterFeatures = water.features || [];
    waterFeatureSources = water.sources || [];
    waterFeatureDetails = water.details || [];
    await sleep(120);
  }

  let phone = null;
  let email = null;
  let skiptraceSource = null;

  if (skiptrace) {
    try {
      const contact = await skiptrace.enrich(parcel);
      if (contact) {
        phone = contact.phone || null;
        email = contact.email || null;
        skiptraceSource = contact.skiptraceSource || contact.source;
        parcel.spokeoId = contact.spokeoId || null;
        parcel.spokeoMatchType = contact.spokeoMatchType || null;
      }
      await sleep(250);
    } catch (error) {
      console.warn(`Skiptrace failed for ${parcel.parcelId}: ${error.message}`);
    }
  }

  const utilities = parcel.utilities?.length
    ? parcel.utilities
    : inferUtilities(parcel);

  return {
    ...parcel,
    lat,
    lng,
    ...signals,
    yrsOwned: yrsOwned ?? 0,
    floodZone,
    waterFeatures,
    waterFeatureSources,
    waterFeatureDetails,
    phone,
    email,
    skiptraceSource,
    utilities,
    hasUtilities: utilities.length > 0,
    isDNC: false,
    multiParcel: 1,
    roadAccess: parcel.frontage >= 100 ? 'Excellent' : parcel.frontage >= 50 ? 'Good' : parcel.frontage > 0 ? 'Fair' : 'Unknown'
  };
}

function inferUtilities(parcel) {
  const city = (parcel.situsAddress?.city || '').toUpperCase();
  const urban = ['CLEARWATER', 'LARGO', 'DUNEDIN', 'TAMPA', 'BRADENTON', 'SARASOTA', 'NEW PORT RICHEY'].includes(city);
  if (urban && parcel.acreage < 5) return ['water', 'electric'];
  if (parcel.acreage < 2) return ['electric'];
  return [];
}

module.exports = {
  getCentroid,
  estimateFrontageFromGeometry,
  getFloodZone,
  getWaterFeatures,
  ownerSignals,
  createSkiptraceProvider,
  enrichParcel,
  normalizeFloodZone
};