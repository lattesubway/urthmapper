const SQFT_PER_ACRE = 43560;

function estimateLotDepth(acreage, frontage) {
  if (!acreage || !frontage || frontage <= 0) return 0;
  const areaSqft = acreage * SQFT_PER_ACRE;
  return Math.round(areaSqft / frontage);
}

function estimateShapeRegularity(acreage, frontage, depth) {
  if (!acreage || !frontage || !depth) return null;
  const areaSqft = acreage * SQFT_PER_ACRE;
  const ratio = frontage / depth;
  const rectangularArea = frontage * depth;
  const areaFit = Math.min(rectangularArea, areaSqft) / Math.max(rectangularArea, areaSqft);
  const ratioScore = ratio >= 0.25 && ratio <= 4 ? 1 : 0.6;
  return Math.round(Math.max(0, Math.min(100, areaFit * ratioScore * 100)));
}

function estimateSubdivisionLots(frontage, depth, minLotWidth = 75, minDepth = 100) {
  if (!frontage || !depth) return 0;
  const byWidth = Math.floor(frontage / minLotWidth);
  const byDepth = Math.floor(depth / minDepth);
  return Math.max(0, byWidth * byDepth);
}

function estimateBuildableAcres(acreage, flags = {}) {
  let factor = 1;
  if (flags.hasWetlandsNearby) factor -= 0.25;
  if (flags.floodZone === 'AE') factor -= 0.15;
  if (flags.inSFHA) factor -= 0.1;
  return Math.round(Math.max(0, acreage * factor) * 100) / 100;
}

module.exports = {
  SQFT_PER_ACRE,
  estimateLotDepth,
  estimateShapeRegularity,
  estimateSubdivisionLots,
  estimateBuildableAcres
};