const DEFAULT_PAGE_SIZE = 500;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryFeatures({
  url,
  where = '1=1',
  outFields = '*',
  geometry = null,
  geometryType = 'esriGeometryEnvelope',
  inSR = 4326,
  spatialRel = 'esriSpatialRelIntersects',
  resultOffset = 0,
  resultRecordCount = DEFAULT_PAGE_SIZE,
  returnGeometry = true,
  outSR = 4326,
  orderByFields = null
}) {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: String(returnGeometry),
    f: 'json',
    resultOffset: String(resultOffset),
    resultRecordCount: String(resultRecordCount)
  });

  if (returnGeometry) {
    params.set('outSR', String(outSR));
  }

  if (geometry) {
    params.set('geometry', typeof geometry === 'string' ? geometry : JSON.stringify(geometry));
    params.set('geometryType', geometryType);
    params.set('inSR', String(inSR));
    params.set('spatialRel', spatialRel);
  }

  if (orderByFields) {
    params.set('orderByFields', orderByFields);
  }

  const response = await fetch(`${url}?${params}`);
  if (!response.ok) {
    throw new Error(`ArcGIS HTTP ${response.status} for ${url}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return data;
}

async function queryAllFeatures(options, { maxRecords = 5000, pageSize = DEFAULT_PAGE_SIZE, delayMs = 200 } = {}) {
  const features = [];
  let offset = 0;

  while (features.length < maxRecords) {
    const data = await queryFeatures({
      ...options,
      resultOffset: offset,
      resultRecordCount: Math.min(pageSize, maxRecords - features.length)
    });

    const batch = data.features || [];
    if (!batch.length) break;

    features.push(...batch);
    if (batch.length < pageSize) break;

    offset += batch.length;
    if (delayMs > 0) await sleep(delayMs);
  }

  return features.slice(0, maxRecords);
}

module.exports = { queryFeatures, queryAllFeatures, sleep };