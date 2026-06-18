const TARGET_CITIES = {
  Pinellas: ['CLEARWATER', 'LARGO', 'DUNEDIN', 'SAFETY HARBOR', 'PALM HARBOR', 'SEMINOLE', 'BELLEAIR', 'BELLEAIR BLUFFS'],
  Hillsborough: ['TAMPA', 'TEMPLE TERRACE', 'BRANDON', 'RIVERVIEW', 'TOWN N COUNTRY'],
  Pasco: ['NEW PORT RICHEY', 'PORT RICHEY', 'HOLIDAY', 'HUDSON', 'LAND O LAKES', 'WESLEY CHAPEL'],
  Manatee: ['BRADENTON', 'PALMETTO', 'ELLENTON', 'PARRISH'],
  Sarasota: ['SARASOTA', 'VENICE', 'NORTH PORT', 'OSPREY', 'NOKOMIS']
};

const VACANT_DOR_PREFIXES = ['00', '10', '19'];

function sqlIn(field, values) {
  return `${field} IN (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`;
}

function isVacantDor(code = '') {
  const normalized = String(code).trim();
  return VACANT_DOR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function classifyOwnerType(name = '') {
  const upper = name.toUpperCase();
  if (/\bLLC\b|\bL\.L\.C\b/.test(upper)) return 'LLC';
  if (/\bTRUST\b/.test(upper)) return 'Trust';
  if (/\bESTATE\b|\bHEIRS?\b/.test(upper)) return 'Estate';
  if (/\bINC\b|\bCORP\b|\bCOMPANY\b|\bCO\b|\bLP\b|\bLLP\b/.test(upper)) return 'Corporate';
  if (/\bHEIRS?\b/.test(upper)) return 'Heirs';
  return 'Individual';
}

function buildSitusStreet(num, addr) {
  const n = num == null ? '' : String(num).trim();
  const a = (addr || '').trim();
  if (!a) return n;
  if (!n) return a;
  return a.split(/\s+/)[0] === n ? a : `${n} ${a}`;
}

function buildMailing(attrs) {
  return {
    line1: attrs.line1 || '',
    line2: attrs.line2 || '',
    city: attrs.city || '',
    state: attrs.state || '',
    zip: attrs.zip || '',
    country: attrs.country || '',
    full: [attrs.line1, attrs.line2, attrs.city, attrs.state, attrs.zip].filter(Boolean).join(', ')
  };
}

const COUNTY_SOURCES = {
  Pinellas: {
    name: 'Pinellas',
    queryUrl: 'https://egis.pinellas.gov/gis/rest/services/PublicWebGIS/Parcels/MapServer/1/query',
    buildWhere({ cities, minLandValue, maxLandValue, minAcres, maxAcres }) {
      const cityClause = sqlIn('SITE_CITY', cities || TARGET_CITIES.Pinellas);
      return [
        cityClause,
        'IMP_VALUE = 0',
        `LAND_VALUE >= ${minLandValue}`,
        `LAND_VALUE <= ${maxLandValue}`,
        `Acres >= ${minAcres}`,
        `Acres <= ${maxAcres}`
      ].join(' AND ');
    },
    parseFeature(feature) {
      const a = feature.attributes;
      const owner = [a.OWNER1, a.OWNER2].filter(Boolean).join(' ').trim();
      const situsStreet = buildSitusStreet(a.SITE_NUM, a.SITE_ADDRESS);
      return {
        county: 'Pinellas',
        parcelId: a.PARCELID_DSP1 || a.PARCELID || a.STRAP,
        owner,
        ownerType: classifyOwnerType(owner),
        situsAddress: {
          street: situsStreet,
          city: a.SITE_CITY || '',
          state: a.SITE_STATE || 'FL',
          zip: a.SITE_ZIP || '',
          full: [situsStreet, a.SITE_CITY, a.SITE_STATE, a.SITE_ZIP].filter(Boolean).join(', ')
        },
        mailingAddress: buildMailing({
          line1: a.OWNADD_1,
          line2: a.OWNADD_2,
          city: a.OWNCITY,
          state: a.OWNSTATE,
          zip: a.OWNZIP,
          country: a.OWNCOUNTRY
        }),
        acreage: Number(a.Acres) || 0,
        landValue: Number(a.LAND_VALUE) || 0,
        improvementValue: Number(a.IMP_VALUE) || 0,
        marketValue: Number(a.TAXABLE_VALUE) || Number(a.LAND_VALUE) || 0,
        zoning: a.USE_CODE || a.LAND_USE_CODE || 'Unknown',
        dorCode: a.USE_CODE || '',
        landUseDescription: a.LEGAL || '',
        frontage: 0,
        saleDate: a.SALEDATE1 || null,
        salePrice: Number(a.SALEPRICE1) || null,
        geometry: feature.geometry,
        sourceLayer: 'pinellas-public-parcels'
      };
    }
  },

  Hillsborough: {
    name: 'Hillsborough',
    queryUrl: 'https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/MapServer/0/query',
    buildWhere({ minLandValue, maxLandValue, minAcres, maxAcres }) {
      return [
        'BLDG = 0',
        `LAND >= ${minLandValue}`,
        `LAND <= ${maxLandValue}`,
        `ACREAGE >= ${minAcres}`,
        `ACREAGE <= ${maxAcres}`,
        "(DOR_CODE LIKE '00%' OR DOR_CODE LIKE '10%')"
      ].join(' AND ');
    },
    parseFeature(feature) {
      const a = feature.attributes;
      const owner = (a.OWNER || '').trim();
      return {
        county: 'Hillsborough',
        parcelId: a.FOLIO || a.PIN || a.STRAP,
        owner,
        ownerType: classifyOwnerType(owner),
        situsAddress: {
          street: a.SITE_ADDR || '',
          city: a.SITE_CITY || a.CITY || '',
          state: 'FL',
          zip: a.SITE_ZIP || a.ZIP || '',
          full: [a.SITE_ADDR, a.SITE_CITY || a.CITY, 'FL', a.SITE_ZIP || a.ZIP].filter(Boolean).join(', ')
        },
        mailingAddress: buildMailing({
          line1: a.ADDR_1,
          line2: a.ADDR_2,
          city: a.CITY,
          state: a.STATE,
          zip: a.ZIP,
          country: a.COUNTRY
        }),
        acreage: Number(a.ACREAGE) || 0,
        landValue: Number(a.LAND) || 0,
        improvementValue: Number(a.BLDG) || 0,
        marketValue: Number(a.MARKET_VAL || a.JUST || a.ASD_VAL) || Number(a.LAND) || 0,
        zoning: a.LU_GRP || a.DOR_CODE || 'Unknown',
        dorCode: a.DOR_CODE || '',
        landUseDescription: [a.LEGAL1, a.LEGAL2, a.LEGAL3].filter(Boolean).join(' '),
        frontage: Number(a['Shape.len']) ? Math.round(Number(a['Shape.len']) / 4) : 0,
        saleDate: a.S_DATE || null,
        salePrice: Number(a.S_AMT) || null,
        geometry: feature.geometry,
        sourceLayer: 'hillsborough-hc-parcels'
      };
    },
    postFilter(parcel) {
      const city = (parcel.situsAddress.city || '').trim().toUpperCase();
      if (!city) return true;
      return TARGET_CITIES.Hillsborough.includes(city);
    }
  },

  Pasco: {
    name: 'Pasco',
    queryUrl: 'https://maps.pascopa.com/arcgis/rest/services/Parcels/MapServer/3/query',
    buildWhere({ minLandValue, maxLandValue, minAcres, maxAcres }) {
      return [
        'VAL_BLDG_DEPR = 0',
        `VAL_LAND >= ${minLandValue}`,
        `VAL_LAND <= ${maxLandValue}`,
        `VAL_ACRES >= ${minAcres}`,
        `VAL_ACRES <= ${maxAcres}`
      ].join(' AND ');
    },
    parseFeature(feature) {
      const a = feature.attributes;
      const owner = [a.NAD_NAME_1, a.NAD_NAME_2].filter(Boolean).join(' ').trim();
      return {
        county: 'Pasco',
        parcelId: a.ParcelID || a.DIR_ID,
        owner,
        ownerType: classifyOwnerType(owner),
        situsAddress: {
          street: a.PHYS_STREET || '',
          city: a.PHYS_CITY || '',
          state: a.PHYS_STATE || 'FL',
          zip: a.PHYS_ZIP || '',
          full: [a.PHYS_STREET, a.PHYS_CITY, a.PHYS_STATE, a.PHYS_ZIP].filter(Boolean).join(', ')
        },
        mailingAddress: buildMailing({
          line1: a.NAD_ADD_1,
          line2: a.NAD_ADD_2,
          city: a.NAD_CITY,
          state: a.NAD_STATE,
          zip: a.NAD_ZIP
        }),
        acreage: Number(a.VAL_ACRES) || 0,
        landValue: Number(a.VAL_LAND) || 0,
        improvementValue: Number(a.VAL_BLDG_DEPR) || 0,
        marketValue: Number(a.VAL_APPR) || Number(a.VAL_LAND) || 0,
        zoning: a.DIR_CLASS || 'Unknown',
        dorCode: a.DIR_CLASS || '',
        landUseCode: a.DIR_CLASS || '',
        landUseDescription: a.SUBSIDENCE_CODE || '',
        frontage: Number(a['shape.STLength()']) ? Math.round(Number(a['shape.STLength()']) / 4) : 0,
        saleDate: a.SALE_YEAR ? new Date(a.SALE_YEAR, (a.SALE_MON || 1) - 1, a.SALE_DAY || 1).toISOString() : null,
        salePrice: Number(a.SALE_AMT) || null,
        hasTaxDelinquency: a.DLQ_FLAGS === 'Y',
        geometry: feature.geometry,
        sourceLayer: 'pasco-parcels'
      };
    },
    postFilter(parcel) {
      const city = (parcel.situsAddress.city || '').toUpperCase();
      return !city || TARGET_CITIES.Pasco.includes(city);
    }
  },

  Manatee: {
    name: 'Manatee',
    queryUrl: 'https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0/query',
    buildWhere({ minLandValue, maxLandValue, minAcres, maxAcres }) {
      return [
        'CER_JUST_IMPVAL = 0',
        `CER_JUST_LNDVAL >= ${minLandValue}`,
        `CER_JUST_LNDVAL <= ${maxLandValue}`,
        `LAND_ACREAGE_CAMA >= ${minAcres}`,
        `LAND_ACREAGE_CAMA <= ${maxAcres}`
      ].join(' AND ');
    },
    parseFeature(feature) {
      const a = feature.attributes;
      const owner = [a.PAR_OWNER_NAME1, a.PAR_OWNER_NAME2].filter(Boolean).join(' ').trim();
      const utilities = [];
      if (a.NAV_SEWER_NAME) utilities.push('sewer');
      if (a.NAV_WATER_NAME) utilities.push('water');
      if (a.NAV_LIGHT_NAME) utilities.push('electric');

      return {
        county: 'Manatee',
        parcelId: a.PARID,
        owner,
        ownerType: classifyOwnerType(owner),
        situsAddress: {
          street: a.SITUS_ADDRESS || '',
          city: a.SITUS_POSTAL_CITY || '',
          state: a.SITUS_STATE || 'FL',
          zip: a.SITUS_POSTAL_ZIP || '',
          full: a.SITUS_ADDRESS || ''
        },
        mailingAddress: buildMailing({
          line1: a.PAR_MAIL_ADDR1,
          line2: a.PAR_MAIL_ADDR2,
          city: a.PAR_MAIL_CITY,
          state: a.PAR_MAIL_STATE,
          zip: a.PAR_MAIL_POSTALCD,
          country: a.PAR_MAIL_COUNTRY
        }),
        acreage: Number(a.LAND_ACREAGE_CAMA) || 0,
        landValue: Number(a.CER_JUST_LNDVAL) || 0,
        improvementValue: Number(a.CER_JUST_IMPVAL) || 0,
        marketValue: Number(a.CER_JUST_VALUE) || Number(a.CER_JUST_LNDVAL) || 0,
        zoning: (a.PAR_ZONING || 'Unknown').split(',')[0].trim(),
        dorCode: a.CUR_DOR_LUC_CODE || '',
        landUseDescription: a.CUR_MAN_LUC_DESC || '',
        frontage: Number(a.LAND_FRONTAGE) || Number(a.LAND_FRONTAGE_EFF) || 0,
        saleDate: a.SALE_DATE_LQ || a.SALE_DATE_LAST || null,
        salePrice: Number(a.SALE_PRICE_LQ || a.SALE_PRICE_LAST) || null,
        utilities,
        sewerProvider: a.NAV_SEWER_NAME || null,
        waterProvider: a.NAV_WATER_NAME || null,
        electricProvider: a.NAV_LIGHT_NAME || null,
        geometry: feature.geometry,
        sourceLayer: 'manatee-parcel-search'
      };
    },
    postFilter(parcel) {
      const city = (parcel.situsAddress.city || '').toUpperCase();
      return !city || TARGET_CITIES.Manatee.includes(city);
    }
  },

  Sarasota: {
    name: 'Sarasota',
    queryUrl: 'https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0/query',
    buildWhere({ minLandValue, maxLandValue, minAcres, maxAcres }) {
      return [
        "STCD IN ('0000','0010','1000')",
        'IMPROVEMT = 0',
        `JUST >= ${minLandValue}`,
        `JUST <= ${maxLandValue}`,
        `MeasuredAcreage >= ${minAcres}`,
        `MeasuredAcreage <= ${maxAcres}`
      ].join(' AND ');
    },
    parseFeature(feature) {
      const a = feature.attributes;
      const owner = (a.NAME1 || '').trim();
      return {
        county: 'Sarasota',
        parcelId: a.ID || a.ACCOUNT,
        owner,
        ownerType: classifyOwnerType(owner),
        situsAddress: {
          street: a.FULLADDRESS || [a.LOCN, a.LOCS, a.LOCT].filter(Boolean).join(' '),
          city: a.LOCCITY || '',
          state: a.LOCSTATE || 'FL',
          zip: a.LOCZIP || '',
          full: a.FULLADDRESS || ''
        },
        mailingAddress: buildMailing({
          line1: a.NAME_ADD4 || a.NAME_ADD2,
          line2: a.NAME_ADD5 || a.NAME_ADD3,
          city: a.CITY,
          state: a.STATE,
          zip: a.ZIP,
          country: a.COUNTRY
        }),
        acreage: Number(a.MeasuredAcreage) || 0,
        landValue: Number(a.LNVS_N || a.JUST) || 0,
        improvementValue: Number(a.IMPROVEMT) || 0,
        marketValue: Number(a.JUST || a.ASSD) || 0,
        zoning: a.ZONING || 'Unknown',
        dorCode: a.STCD || '',
        landUseDescription: [a.LEGAL1, a.LEGAL2].filter(Boolean).join(' '),
        frontage: Number(a.Shape__Length) ? Math.round(Number(a.Shape__Length) / 4) : 0,
        saleDate: a.SALE_DATE || null,
        salePrice: Number(a.SALE_AMT) || null,
        geometry: feature.geometry,
        sourceLayer: 'sarasota-parcel-hosted'
      };
    },
    postFilter(parcel) {
      const city = (parcel.situsAddress.city || '').toUpperCase();
      return !city || TARGET_CITIES.Sarasota.includes(city);
    }
  }
};

module.exports = {
  TARGET_CITIES,
  COUNTY_SOURCES,
  classifyOwnerType,
  isVacantDor
};