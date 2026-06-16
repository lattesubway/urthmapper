const MH_ZONINGS = ['MH', 'RMF', 'RM', 'R-MH', 'MHR'];

function scoreLead(lead) {
  let score = 0;
  const breakdown = [];

  if (lead.landValue > 0 && lead.landValue <= 25000) {
    score += 25;
    breakdown.push('Land under $25K (+25)');
  } else if (lead.landValue <= 50000) {
    score += 15;
    breakdown.push('Land under $50K (+15)');
  } else if (lead.landValue <= 100000) {
    score += 8;
    breakdown.push('Land under $100K (+8)');
  }

  if (lead.frontage >= 100) {
    score += 20;
    breakdown.push('Frontage 100+ ft (+20)');
  } else if (lead.frontage >= 50) {
    score += 15;
    breakdown.push('Frontage 50+ ft (+15)');
  } else if (lead.frontage >= 25) {
    score += 5;
    breakdown.push('Frontage 25+ ft (+5)');
  }

  if (lead.isOOS) {
    score += 15;
    breakdown.push('Out-of-state owner (+15)');
  } else if (lead.isAbsentee) {
    score += 10;
    breakdown.push('Absentee owner (+10)');
  }

  if (['Heirs', 'Estate', 'Trust'].includes(lead.ownerType)) {
    score += 10;
    breakdown.push(`${lead.ownerType} owner (+10)`);
  } else if (lead.ownerType === 'LLC' || lead.ownerType === 'Corporate') {
    score += 6;
    breakdown.push(`${lead.ownerType} owner (+6)`);
  }

  if (lead.hasUtilities && lead.utilities.length >= 2) {
    score += 12;
    breakdown.push('Utilities available (+12)');
  } else if (lead.hasUtilities) {
    score += 6;
    breakdown.push('Partial utilities (+6)');
  }

  if (lead.floodZone === 'None' || lead.floodZone === 'X') {
    score += 8;
    breakdown.push('Low flood risk (+8)');
  } else if (lead.floodZone === 'AE') {
    score -= 10;
    breakdown.push('AE flood zone (-10)');
  }

  if (lead.phone && !lead.isDNC) {
    score += 10;
    breakdown.push('Reachable phone (+10)');
  }

  if (lead.email) {
    score += 5;
    breakdown.push('Email on file (+5)');
  }

  if (lead.waterFeatures?.length) {
    score += 4;
    breakdown.push(`Water features: ${lead.waterFeatures.join(', ')} (+4)`);
  }

  if (lead.yrsOwned >= 10) {
    score += 8;
    breakdown.push('10+ years owned (+8)');
  } else if (lead.yrsOwned >= 5) {
    score += 4;
    breakdown.push('5+ years owned (+4)');
  }

  if (MH_ZONINGS.some((z) => (lead.zoning || '').toUpperCase().includes(z))) {
    score += 5;
    breakdown.push('MH-friendly zoning (+5)');
  }

  if (lead.hasTaxDelinquency) {
    score -= 8;
    breakdown.push('Tax delinquency (-8)');
  }

  if (lead.pricePerAcre && lead.pricePerAcre <= 10000) {
    score += 10;
    breakdown.push('Under $10K/acre (+10)');
  } else if (lead.pricePerAcre && lead.pricePerAcre <= 15000) {
    score += 6;
    breakdown.push('Under $15K/acre (+6)');
  } else if (lead.pricePerAcre && lead.pricePerAcre <= 25000) {
    score += 3;
    breakdown.push('Under $25K/acre (+3)');
  }

  if (lead.estSubdivisionLots >= 3) {
    score += 10;
    breakdown.push(`${lead.estSubdivisionLots} subdivision lots (+10)`);
  } else if (lead.estSubdivisionLots >= 2) {
    score += 6;
    breakdown.push(`${lead.estSubdivisionLots} subdivision lots (+6)`);
  }

  if (lead.isPortfolioOwner && lead.ownerParcelCount >= 3) {
    score += 8;
    breakdown.push(`Portfolio owner (${lead.ownerParcelCount} parcels) (+8)`);
  } else if (lead.isPortfolioOwner) {
    score += 4;
    breakdown.push('Multi-parcel owner (+4)');
  }

  if (lead.sewerAvailable && lead.sewerType === 'public') {
    score += 10;
    breakdown.push('Public sewer (+10)');
  } else if (lead.sewerAvailable) {
    score += 5;
    breakdown.push('Sewer on file (+5)');
  } else if (lead.sewerType === 'septic-likely') {
    breakdown.push('Septic likely (no sewer)');
  }

  if (lead.waterAvailable && lead.waterType === 'public') {
    score += 4;
    breakdown.push('Public water (+4)');
  }

  if (lead.nearestRoad) {
    score += 4;
    breakdown.push(`Road: ${lead.nearestRoad} (+4)`);
  }

  if (lead.distToHighwayMi != null && lead.distToHighwayMi <= 5) {
    score += 5;
    breakdown.push(`Near ${lead.highwayName || 'highway'} (${lead.distToHighwayMi} mi) (+5)`);
  }

  if (lead.developmentPotential === 'High') {
    score += 6;
    breakdown.push('High development potential (+6)');
  }

  if (lead.hasWetlandsNearby) {
    score -= 6;
    breakdown.push('Wetlands nearby (-6)');
  }

  if (lead.legalAccess === 'Unknown' && !lead.nearestRoad) {
    score -= 5;
    breakdown.push('Road access unverified (-5)');
  }

  if (lead.equityVsSalePct != null && lead.equityVsSalePct >= 50) {
    score += 5;
    breakdown.push('Strong equity vs last sale (+5)');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    breakdown
  };
}

function passesInvestorFilters(lead, filters) {
  if (lead.landValue < filters.minLandValue || lead.landValue > filters.maxLandValue) return false;
  if (lead.acreage < filters.minAcres || lead.acreage > filters.maxAcres) return false;
  if (filters.requireMotivatedOwner && !lead.isOOS && !lead.isAbsentee && !['LLC', 'Trust', 'Estate', 'Heirs', 'Corporate'].includes(lead.ownerType)) {
    return false;
  }
  if (filters.minScore && lead.score < filters.minScore) return false;
  return true;
}

module.exports = { scoreLead, passesInvestorFilters };