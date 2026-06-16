const SQFT_PER_ACRE = 43560;

function maxReasonableFrontage(acreage) {
  if (!acreage || acreage <= 0) return 0;
  const area = acreage * SQFT_PER_ACRE;
  return Math.max(75, Math.round(2.8 * Math.sqrt(area)));
}

function estimateFrontageFromAcreage(acreage, ratio = 2) {
  if (!acreage || acreage <= 0) return 0;
  const area = acreage * SQFT_PER_ACRE;
  return Math.round(Math.sqrt(area / ratio));
}

function refineFrontage(lead = {}) {
  let frontage = Number(lead.frontage) || 0;
  const acreage = lead.acreage || 0;
  const cap = maxReasonableFrontage(acreage);

  if (!frontage && acreage > 0) {
    return {
      frontage: estimateFrontageFromAcreage(acreage),
      frontageSource: 'estimated-from-acreage',
      frontageConfidence: 'low'
    };
  }

  if (cap > 0 && frontage > cap * 1.8) {
    return {
      frontage: estimateFrontageFromAcreage(acreage, 1.6),
      frontageSource: 'corrected-from-acreage',
      frontageConfidence: 'medium'
    };
  }

  return {
    frontage: Math.round(frontage),
    frontageSource: lead.frontageSource || 'county-gis',
    frontageConfidence: lead.frontageSource === 'county-gis' ? 'high' : 'medium'
  };
}

function roadFrontageLabel(lead = {}) {
  if (lead.nearestRoad && lead.frontage) {
    return `${lead.frontage} ft on ${lead.nearestRoad}`;
  }
  if (lead.frontage) return `${lead.frontage} ft`;
  return 'Unknown';
}

module.exports = {
  SQFT_PER_ACRE,
  maxReasonableFrontage,
  estimateFrontageFromAcreage,
  refineFrontage,
  roadFrontageLabel
};