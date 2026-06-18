/**
 * Urthmapper Lead Filter Utilities
 * Filter and sort leads by motivation signals, location, and property criteria
 */

/**
 * Example filter function you can call on your leads array
 * @param {Array} leads - Array of lead objects
 * @param {Object} filters - Filter criteria
 * @returns {Array} Filtered leads
 */
function filterLeads(leads, filters = {}) {
  return leads.filter(lead => {
    // Quick filters
    if (filters.absenteeOnly && !lead.is_absentee) return false;
    if (filters.heirsEstateOnly && !lead.is_trust_or_estate) return false;
    if (filters.clearwaterOnly && !lead.city?.toUpperCase().includes('CLEARWATER')) return false;

    // Score range
    if (lead.lead_score < (filters.minScore || 0)) return false;
    if (filters.maxScore && lead.lead_score > filters.maxScore) return false;

    // Acreage
    if (filters.minAcreage && (lead.acreage || 0) < filters.minAcreage) return false;
    if (filters.maxAcreage && (lead.acreage || 0) > filters.maxAcreage) return false;

    // Flood zone
    if (filters.noHighFlood && ['AE', 'VE', 'A', 'V'].includes(lead.floodZone?.toUpperCase())) {
      return false;
    }

    // Land value
    if (filters.minLandValue && (lead.landValue || 0) < filters.minLandValue) return false;
    if (filters.maxLandValue && (lead.landValue || 0) > filters.maxLandValue) return false;

    // County filter
    if (filters.county && lead.county?.toUpperCase() !== filters.county.toUpperCase()) return false;

    // Owner type filter
    if (filters.ownerType && lead.ownerType?.toUpperCase() !== filters.ownerType.toUpperCase()) return false;

    // Has contact info
    if (filters.hasPhone && !lead.phone && (!lead.phones || lead.phones.length === 0)) return false;
    if (filters.hasEmail && !lead.email && (!lead.emails || lead.emails.length === 0)) return false;

    return true;
  });
}

/**
 * Sort leads by various criteria
 * @param {Array} leads - Array of lead objects
 * @param {string} sortBy - Sort field
 * @param {boolean} ascending - Sort direction
 * @returns {Array} Sorted leads (new array)
 */
function sortLeads(leads, sortBy = 'lead_score', ascending = false) {
  return [...leads].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    // Handle null/undefined
    if (aVal == null) aVal = ascending ? Infinity : -Infinity;
    if (bVal == null) bVal = ascending ? Infinity : -Infinity;

    // Handle strings
    if (typeof aVal === 'string') aVal = aVal.toUpperCase();
    if (typeof bVal === 'string') bVal = bVal.toUpperCase();

    if (aVal < bVal) return ascending ? -1 : 1;
    if (aVal > bVal) return ascending ? 1 : -1;
    return 0;
  });
}

/**
 * Get lead statistics
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Statistics
 */
function getLeadStats(leads) {
  const stats = {
    total: leads.length,
    byCounty: {},
    byOwnerType: {},
    absenteeCount: 0,
    trustEstateCount: 0,
    avgScore: 0,
    avgAcreage: 0,
    avgLandValue: 0,
    scoreDistribution: {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '50-59': 0,
      'below-50': 0
    }
  };

  let totalScore = 0;
  let totalAcreage = 0;
  let totalLandValue = 0;

  leads.forEach(lead => {
    // County
    const county = lead.county || 'Unknown';
    stats.byCounty[county] = (stats.byCounty[county] || 0) + 1;

    // Owner type
    const ownerType = lead.ownerType || 'Unknown';
    stats.byOwnerType[ownerType] = (stats.byOwnerType[ownerType] || 0) + 1;

    // Absentee
    if (lead.is_absentee) stats.absenteeCount++;

    // Trust/Estate
    if (lead.is_trust_or_estate) stats.trustEstateCount++;

    // Averages
    totalScore += lead.lead_score || 0;
    totalAcreage += lead.acreage || 0;
    totalLandValue += lead.landValue || 0;

    // Score distribution
    const score = lead.lead_score || 0;
    if (score >= 90) stats.scoreDistribution['90-100']++;
    else if (score >= 80) stats.scoreDistribution['80-89']++;
    else if (score >= 70) stats.scoreDistribution['70-79']++;
    else if (score >= 60) stats.scoreDistribution['60-69']++;
    else if (score >= 50) stats.scoreDistribution['50-59']++;
    else stats.scoreDistribution['below-50']++;
  });

  if (leads.length > 0) {
    stats.avgScore = Math.round(totalScore / leads.length);
    stats.avgAcreage = Math.round((totalAcreage / leads.length) * 100) / 100;
    stats.avgLandValue = Math.round(totalLandValue / leads.length);
  }

  return stats;
}

/**
 * Get top leads by score
 * @param {Array} leads - Array of lead objects
 * @param {number} limit - Number of leads to return
 * @param {Object} filters - Optional filters to apply first
 * @returns {Array} Top leads
 */
function getTopLeads(leads, limit = 10, filters = {}) {
  const filtered = filterLeads(leads, filters);
  return sortLeads(filtered, 'lead_score', false).slice(0, limit);
}

/**
 * Export leads to CSV
 * @param {Array} leads - Array of lead objects
 * @param {string} filename - Output filename
 */
function exportLeadsCSV(leads, filename = 'leads-export.csv') {
  const columns = [
    'id', 'parcelId', 'county', 'owner', 'ownerType', 'city', 'state',
    'is_absentee', 'is_trust_or_estate', 'lead_score', 'motivation_flags',
    'acreage', 'landValue', 'pricePerAcre', 'floodZone', 'zoning',
    'phone', 'email', 'status'
  ];

  const header = columns.join(',');
  const rows = leads.map(lead => {
    return columns.map(col => {
      let val = lead[col];
      if (Array.isArray(val)) val = val.join('; ');
      if (typeof val === 'boolean') val = val ? 'Yes' : 'No';
      if (val == null) val = '';
      // Escape quotes and wrap in quotes if contains comma
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val}"`;
      }
      return val;
    }).join(',');
  });

  const csv = [header, ...rows].join('\n');
  
  // Download in browser
  if (typeof window !== 'undefined') {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  return csv;
}

// Node.js exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterLeads,
    sortLeads,
    getLeadStats,
    getTopLeads,
    exportLeadsCSV
  };
}
