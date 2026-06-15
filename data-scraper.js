/**
 * Real Estate Lead Data Scraper
 * Clearwater, FL Area - Pinellas, Hillsborough, Pasco, Manatee, Sarasota Counties
 * 
 * Filters for:
 * - 50-60% of appraised value (ARV potential)
 * - Out-of-state owners / Absentee owners
 * - Good road access (frontage)
 * - No title issues
 * - Utilities available
 * - Proper zoning
 */

// ============================================
// CONFIG
// ============================================
const CONFIG = {
  counties: {
    pinellas: { 
      name: 'Pinellas',
      appraiser: 'https://www.pinellas.floridaparentchild.com',
      endpoint: 'api/properties' 
    },
    hillsborough: { 
      name: 'Hillsborough',
      appraiser: 'https://www.hcpafl.org',
      endpoint: 'api/search'
    },
    pasco: { 
      name: 'Pasco',
      appraiser: 'https://www.pascodeeds.org',
      endpoint: 'api/parcels'
    },
    manatee: { 
      name: 'Manatee',
      appraiser: 'https://www.manateepa.com',
      endpoint: 'api/properties'
    },
    sarasota: { 
      name: 'Sarasota',
      appraiser: 'https://www.sarasotapafl.org',
      endpoint: 'api/parcels'
    }
  },
  criteria: {
    valueBandMin: 0.50,      // 50% of ARV
    valueBandMax: 0.60,      // 60% of ARV
    minFrontage: 50,         // feet
    maxAcreage: 20,
    goodZonings: ['R-1', 'R-2', 'R-3', 'MH', 'RMF', 'AG', 'Commercial', 'Industrial'],
    requireUtilities: true,
    requiredUtilities: ['water', 'sewer', 'electric'],
    requireRoadAccess: true,
    vacantLandClasses: ['vacant', 'vacant land', 'undeveloped', 'brownfield', 'residential vacant', 'commercial vacant', 'municipal'],
    maxImprovementRatio: 0.1,
    maxImperviousRatio: 0.35,
    minNdvi: 0.25
  },
  contact: {
    provider: process.env.CONTACT_PROVIDER || 'public',
    apiKey: process.env.CONTACT_API_KEY || null,
    maxPublicSearchPages: 3
  },
  publicRecord: {
    enableOwnerEnrichment: true,
    provider: 'county-appraiser'
  }
};

// ============================================
// ZILLOW API INTEGRATION
// ============================================
class ZillowDataProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://www.zillow.com/api';
  }

  /**
   * Search properties by criteria
   * Note: Requires Zillow API key (get at developer.zillow.com)
   */
  async searchProperties(county, filters) {
    try {
      // This is a placeholder - actual implementation requires API key
      const url = `${this.baseUrl}/property/search`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          county: county,
          filters: {
            priceMin: filters.priceMin,
            priceMax: filters.priceMax,
            propertyType: ['Land'],
            status: ['ForSale', 'OffMarket']
          }
        })
      });
      
      return await response.json();
    } catch (error) {
      console.error('Zillow API error:', error);
      return null;
    }
  }

  /**
   * Get comparable sales for ARV calculation
   */
  async getComparables(parcelId, county) {
    try {
      const url = `${this.baseUrl}/comparables/${parcelId}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return await response.json();
    } catch (error) {
      console.error('Error fetching comparables:', error);
      return null;
    }
  }
}

// ============================================
// COUNTY ASSESSOR DATA PROVIDER
// ============================================
class CountyAssessorProvider {
  /**
   * Fetch parcel data from county assessor
   * Uses public record APIs where available
   */
  async getParcelData(countyCode, filters = {}) {
    const county = CONFIG.counties[countyCode];
    if (!county) throw new Error(`Invalid county code: ${countyCode}`);

    try {
      // Most Florida county assessors have public search APIs
      // This fetches from their public endpoint
      const searchParams = new URLSearchParams({
        status: 'active',
        propertyType: 'land',
        ...filters
      });

      const response = await fetch(
        `${county.appraiser}/${county.endpoint}?${searchParams}`,
        { method: 'GET' }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching ${county.name} assessor data:`, error);
      return [];
    }
  }

  /**
   * Get deed/ownership information
   */
  async getOwnershipInfo(parcelId, county) {
    try {
      const county_obj = CONFIG.counties[county];
      const response = await fetch(
        `${county_obj.appraiser}/ownership/${parcelId}`
      );
      return await response.json();
    } catch (error) {
      console.error('Error fetching ownership:', error);
      return null;
    }
  }
}

class PeopleDataLabsProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.peopledatalabs.com/v5/person';
  }

  async enrichOwner(ownerData = {}, parcelData = {}, countyCode = null) {
    if (!this.apiKey) return null;

    const payload = {
      name: ownerData.name || ownerData.ownerName || parcelData.owner || '',
      address: ownerData.mailingAddress?.street || parcelData.address || '',
      city: ownerData.mailingAddress?.city || parcelData.city || '',
      state: ownerData.mailingAddress?.state || parcelData.state || 'FL',
      postal_code: ownerData.mailingAddress?.zip || parcelData.zip || undefined
    };

    try {
      const response = await fetch(`${this.baseUrl}/enrich`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('PeopleDataLabs response error:', response.status, errorBody);
        return null;
      }

      const data = await response.json();
      return {
        phone: Array.isArray(data.phone_numbers) ? data.phone_numbers.find(num => num.type === 'mobile')?.number || data.phone_numbers[0]?.number : null,
        email: Array.isArray(data.emails) ? data.emails[0]?.value : null,
        source: 'peopledatalabs',
        raw: data
      };
    } catch (error) {
      console.error('PeopleDataLabs fetch failed:', error);
      return null;
    }
  }
}

class ReishubProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.reishub.com/v1/skiptrace';
  }

  async enrichOwner(ownerData = {}, parcelData = {}, countyCode = null) {
    if (!this.apiKey) return null;

    const payload = {
      full_name: ownerData.name || ownerData.ownerName || parcelData.owner || '',
      address: ownerData.mailingAddress?.street || parcelData.address || '',
      city: ownerData.mailingAddress?.city || parcelData.city || '',
      state: ownerData.mailingAddress?.state || parcelData.state || 'FL',
      zip: ownerData.mailingAddress?.zip || parcelData.zip || undefined,
      parcel_id: parcelData.parcelNumber || parcelData.id
    };

    try {
      const response = await fetch(`${this.baseUrl}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('REISHub response error:', response.status, errorBody);
        return null;
      }

      const data = await response.json();
      const phone = data.contact?.phone || data.phone || (Array.isArray(data.phone_numbers) ? data.phone_numbers[0]?.number : null);
      const email = data.contact?.email || data.email || (Array.isArray(data.emails) ? data.emails[0]?.value : null);

      return {
        phone: phone || null,
        email: email || null,
        source: 'reishub',
        raw: data
      };
    } catch (error) {
      console.error('REISHub fetch failed:', error);
      return null;
    }
  }
}

class PublicOwnerEnrichmentProvider {
  constructor() {
    this.provider = CONFIG.publicRecord.provider;
  }

  async enrichOwner(ownerData = {}, parcelData = {}, countyCode = null) {
    if (!CONFIG.publicRecord.enableOwnerEnrichment) return null;

    const enrichment = {
      phone: ownerData.phone || null,
      email: ownerData.email || null,
      source: 'public-records'
    };

    if (!enrichment.phone || !enrichment.email) {
      const pageData = await this.searchPublicRecords(ownerData, parcelData, countyCode);
      if (pageData) {
        enrichment.phone = enrichment.phone || pageData.phone;
        enrichment.email = enrichment.email || pageData.email;
      }
    }

    return enrichment;
  }

  async searchPublicRecords(ownerData, parcelData, countyCode) {
    const candidates = this.buildPublicSearchUrls(ownerData, parcelData, countyCode);
    for (const url of candidates) {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) continue;
        const text = await response.text();
        const phone = this.extractPhone(text);
        const email = this.extractEmail(text);
        if (phone || email) {
          return { phone, email };
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  buildPublicSearchUrls(ownerData, parcelData, countyCode) {
    const county = CONFIG.counties[countyCode];
    const owner = encodeURIComponent(ownerData.name || '');
    const parcel = encodeURIComponent(parcelData.parcelNumber || parcelData.id || '');
    const urls = [];

    if (county?.appraiser) {
      urls.push(`${county.appraiser}/search?owner=${owner}`);
      urls.push(`${county.appraiser}/search?parcel=${parcel}`);
      urls.push(`${county.appraiser}/search?ownerName=${owner}`);
    }

    return urls.slice(0, CONFIG.contact.maxPublicSearchPages);
  }

  extractPhone(text) {
    const match = text.match(/\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
    return match ? match[0] : null;
  }

  extractEmail(text) {
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
  }
}

class OwnerContactProvider {
  constructor() {
    this.provider = CONFIG.contact.provider;
    this.apiKey = CONFIG.contact.apiKey;
    this.publicProvider = new PublicOwnerEnrichmentProvider();
    this.paidProvider = null;

    switch (this.provider) {
      case 'peopledatalabs':
        this.paidProvider = new PeopleDataLabsProvider(this.apiKey);
        break;
      case 'reishub':
        this.paidProvider = new ReishubProvider(this.apiKey);
        break;
      default:
        this.paidProvider = null;
        break;
    }
  }

  async enrichOwner(ownerData = {}, parcelData = {}, countyCode = null) {
    if (this.provider === 'public' || !this.apiKey || !this.paidProvider) {
      return this.publicProvider.enrichOwner(ownerData, parcelData, countyCode);
    }

    const paidResult = await this.paidProvider.enrichOwner(ownerData, parcelData, countyCode);
    if (paidResult && (paidResult.phone || paidResult.email)) {
      return paidResult;
    }

    return this.publicProvider.enrichOwner(ownerData, parcelData, countyCode);
  }
}

class VacantLandDetector {
  static isVacantLand(parcelData) {
    const description = String(parcelData.landUse || parcelData.propertyType || parcelData.description || '').toLowerCase();
    const vacantLabel = CONFIG.criteria.vacantLandClasses.some(label => description.includes(label));

    const improvementValue = parseFloat(parcelData.improvementValue || parcelData.buildingValue || 0);
    const landValue = parseFloat(parcelData.landValue || parcelData.assessedValue || 0);
    const improvementRatio = landValue > 0 ? improvementValue / landValue : 0;
    const noStructure = Number(parcelData.buildingArea || parcelData.structureArea || 0) === 0 ||
      Number(parcelData.structureCount || 0) === 0;

    const remote = parcelData.remoteFeatures || {};
    const vacantRemoteLandUse = String(remote.landUseCode || '').toLowerCase();
    const remoteLandUseMatch = CONFIG.criteria.vacantLandClasses.some(label => vacantRemoteLandUse.includes(label));
    const noOsmBuildings = remote.buildingCount === 0;

    return vacantLabel || noStructure || improvementRatio <= CONFIG.criteria.maxImprovementRatio ||
      remoteLandUseMatch || noOsmBuildings;
  }

  static getRemoteSignature(parcelData) {
    const remote = parcelData.remoteFeatures || {};
    return {
      imperviousMatch: remote.imperviousRatio != null && remote.imperviousRatio <= CONFIG.criteria.maxImperviousRatio,
      ndviMatch: remote.ndvi != null && remote.ndvi >= CONFIG.criteria.minNdvi,
      openInfill: remote.buildingCount === 0
    };
  }
}

class OpenStreetMapProvider {
  async getParcelRemoteFeatures(parcel) {
    const lat = parseFloat(parcel.latitude || parcel.lat);
    const lng = parseFloat(parcel.longitude || parcel.lng);
    if (!lat || !lng) return null;

    const delta = 0.0006;
    const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const query = `[out:json][timeout:10];(way["building"](${bbox});relation["building"](${bbox});way["landuse"](${bbox});relation["landuse"](${bbox}););out tags;`;

    try {
      const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      if (!response.ok) return null;
      const data = await response.json();

      const buildings = data.elements.filter(e => e.tags && e.tags.building);
      const landUseElement = data.elements.find(e => e.tags && e.tags.landuse);
      const landUseCode = landUseElement?.tags?.landuse || null;
      return {
        buildingCount: buildings.length,
        landUseCode
      };
    } catch (error) {
      console.error('OSM remote feature error:', error);
      return null;
    }
  }
}

// ============================================
// LEAD FILTER & PROCESSOR
// ============================================
class LeadProcessor {
  /**
   * Determine if owner is out-of-state or absentee
   */
  static isTargetOwner(ownerData) {
    const mailingState = ownerData.mailingAddress?.state;
    const propertyState = ownerData.propertyAddress?.state || 'FL';
    
    // Out-of-state
    if (mailingState && mailingState !== 'FL' && mailingState !== propertyState) {
      return { type: 'out-of-state', reason: `Owner in ${mailingState}` };
    }

    // Absentee (same state but different city/county)
    if (mailingState === 'FL') {
      const mailingCounty = ownerData.mailingAddress?.county;
      const propertyCounty = ownerData.propertyAddress?.county;
      if (mailingCounty && mailingCounty !== propertyCounty) {
        return { type: 'absentee', reason: 'Different county mailing address' };
      }
    }

    // LLC/Corporate (often absentee/investor)
    if (ownerData.ownerType?.match(/LLC|Trust|Estate|Company|Corp/i)) {
      return { type: 'entity', reason: ownerData.ownerType };
    }

    return null;
  }

  /**
   * Calculate ARV and discount percentage
   */
  static calculateValue(parcelData) {
    const assessedValue = parseFloat(parcelData.assessedValue);
    const marketValue = parseFloat(parcelData.marketValue) || assessedValue * 1.2;
    
    return {
      assessedValue,
      marketValue,
      discountPct: Math.round(((marketValue - assessedValue) / marketValue) * 100)
    };
  }

  /**
   * Score lead based on criteria
   */
  static scoreProspect(parcelData, ownerData, comparables = []) {
    let score = 0;

    // VALUE BAND (50-60% of ARV)
    const values = this.calculateValue(parcelData);
    if (values.discountPct >= CONFIG.criteria.valueBandMin * 100 && 
        values.discountPct <= CONFIG.criteria.valueBandMax * 100) {
      score += 25;
    }

    // RESEARCH-DRIVEN VACANT LAND SIGNALS
    if (VacantLandDetector.isVacantLand(parcelData)) {
      score += 20;
    }
    const remoteSig = VacantLandDetector.getRemoteSignature(parcelData);
    if (remoteSig.imperviousMatch) score += 5;
    if (remoteSig.ndviMatch) score += 5;
    if (remoteSig.openInfill) score += 5;

    // FRONTAGE / ROAD ACCESS
    const frontage = parseFloat(parcelData.frontage) || 0;
    if (frontage >= CONFIG.criteria.minFrontage) {
      score += 15;
      if (frontage >= 100) score += 10;
    }

    // UTILITIES
    const hasRequiredUtilities = CONFIG.criteria.requiredUtilities.every(util =>
      parcelData.utilities?.includes(util)
    );
    if (hasRequiredUtilities) score += 20;

    // ZONING
    if (CONFIG.criteria.goodZonings.includes(parcelData.zoning)) {
      score += 15;
    }

    // TITLE/LIEN STATUS
    if (!parcelData.hasLiens && !parcelData.hasTaxDelinquency) {
      score += 15;
    }

    // OWNER TYPE BONUS
    const ownerType = this.isTargetOwner(ownerData);
    if (ownerType) {
      score += 10;
    }

    // COMPARABLES / MARKET STRENGTH
    if (comparables.length >= 3) {
      score += 5;
    }

    return Math.min(100, score);
  }

  /**
   * Filter leads by criteria
   */
  static filterLeads(parcels, ownerData, criteria = CONFIG.criteria) {
    return parcels.filter(parcel => {
      // Check utilities
      if (criteria.requireUtilities) {
        const hasUtilities = criteria.requiredUtilities.every(util =>
          parcel.utilities?.includes(util)
        );
        if (!hasUtilities) return false;
      }

      // Check road access
      if (criteria.requireRoadAccess) {
        if (!parcel.frontage || parseFloat(parcel.frontage) < criteria.minFrontage) {
          return false;
        }
      }

      // Check zoning
      if (!criteria.goodZonings.includes(parcel.zoning)) {
        return false;
      }

      // Check title issues
      if (parcel.hasLiens || parcel.hasTaxDelinquency) {
        return false;
      }

      // Use research-guided vacant land detection
      if (!VacantLandDetector.isVacantLand(parcel)) {
        return false;
      }

      // Check value band
      const values = this.calculateValue(parcel);
      if (values.discountPct < criteria.valueBandMin * 100 || 
          values.discountPct > criteria.valueBandMax * 100) {
        return false;
      }

      return true;
    });
  }
}

// ============================================
// MAIN DATA AGGREGATOR
// ============================================
class LeadAggregator {
  constructor(zillowApiKey = null) {
    this.zillow = zillowApiKey ? new ZillowDataProvider(zillowApiKey) : null;
    this.assessor = new CountyAssessorProvider();
    this.remote = new OpenStreetMapProvider();
    this.ownerEnrichment = new OwnerContactProvider();
    this.leads = [];
  }

  /**
   * Fetch all leads for all counties
   */
  async fetchAllLeads() {
    const allLeads = [];
    const countyKeys = Object.keys(CONFIG.counties);

    for (const countyCode of countyKeys) {
      console.log(`Fetching leads for ${CONFIG.counties[countyCode].name}...`);
      try {
        const parcels = await this.assessor.getParcelData(countyCode);
        
        for (const parcel of parcels) {
          // Enrich with open-source remote data to support vacant land detection
          parcel.remoteFeatures = await this.remote.getParcelRemoteFeatures(parcel);
          
          // Get ownership info
          const ownerData = await this.assessor.getOwnershipInfo(parcel.id, countyCode);
          
          // Skip if ownership info is unavailable
          if (!ownerData || !ownerData.name) continue;

          // Check if target owner type
          const targetOwner = LeadProcessor.isTargetOwner(ownerData);
          if (!targetOwner) continue;

          // Enrich with owner contact info from paid or public sources
          const ownerEnrichment = await this.ownerEnrichment.enrichOwner(ownerData, parcel, countyCode);

          // Get comparables
          const comparables = this.zillow ? 
            await this.zillow.getComparables(parcel.id, countyCode) : [];

          // Calculate score
          const scoreVal = LeadProcessor.scoreProspect(parcel, ownerData, comparables);
          if (scoreVal < 60) continue; // Minimum threshold

          // Build lead object
          const lead = {
            id: parcel.id,
            parcelId: parcel.parcelNumber,
            county: CONFIG.counties[countyCode].name,
            address: parcel.address,
            city: parcel.city,
            state: 'FL',
            
            // Owner info
            owner: ownerData.name,
            ownerType: ownerData.ownerType,
            mailState: ownerData.mailingAddress?.state,
            isOOS: targetOwner.type === 'out-of-state',
            isAbsentee: targetOwner.type === 'absentee',
            phone: ownerEnrichment?.phone || ownerData.phone || null,
            email: ownerEnrichment?.email || ownerData.email || null,
            enrichmentSource: ownerEnrichment?.source || 'public-records',
            
            // Property details
            acreage: parseFloat(parcel.acreage),
            zoning: parcel.zoning,
            frontage: parseInt(parcel.frontage) || 0,
            floodZone: parcel.floodZone || 'None',
            
            // Value info
            assessedValue: parseFloat(parcel.assessedValue),
            marketValue: parseFloat(parcel.marketValue),
            arv: parseFloat(parcel.marketValue) || parseFloat(parcel.assessedValue) * 1.2,
            
            // Status flags
            hasUtilities: parcel.utilities?.length > 0,
            utilities: parcel.utilities || [],
            hasLiens: parcel.hasLiens || false,
            hasTaxDelinquency: parcel.hasTaxDelinquency || false,
            roadAccess: parcel.frontage ? 'Good' : 'Limited',
            
            // Scoring
            score: scoreVal,
            comparables: comparables?.length || 0,
            
            // Tracking
            status: 'New',
            favorite: false,
            lat: parcel.latitude,
            lng: parcel.longitude
          };

          allLeads.push(lead);
        }
      } catch (error) {
        console.error(`Error processing ${CONFIG.counties[countyCode].name}:`, error);
      }
    }

    // Sort by score descending
    this.leads = allLeads.sort((a, b) => b.score - a.score);
    console.log(`Total leads fetched: ${this.leads.length}`);
    
    return this.leads;
  }

  /**
   * Export leads for integration
   */
  exportForApp() {
    return JSON.stringify(this.leads, null, 2);
  }

  /**
   * Save to file
   */
  async saveToFile(filename = 'leads.json') {
    const fs = require('fs');
    fs.writeFileSync(filename, this.exportForApp());
    console.log(`Leads saved to ${filename}`);
  }
}

// ============================================
// USAGE EXAMPLE
// ============================================
if (typeof module !== 'undefined' && require.main === module) {
  (async () => {
    const aggregator = new LeadAggregator();
    
    // Fetch all leads
    const leads = await aggregator.fetchAllLeads();
    
    console.log(`\n✓ Found ${leads.length} qualified leads`);
    console.log('\nTop 10 Prospects:');
    leads.slice(0, 10).forEach((lead, i) => {
      console.log(`${i+1}. ${lead.owner} (${lead.county}) - Score: ${lead.score}${lead.phone ? ` - ${lead.phone}` : ''}${lead.email ? ` - ${lead.email}` : ''}`);
    });
    
    // Save to file
    await aggregator.saveToFile('clearwater-leads.json');
  })();
}

// Export for use in browser/other modules
if (typeof module !== 'undefined') {
  module.exports = { LeadAggregator, LeadProcessor, CountyAssessorProvider, CONFIG };
}
