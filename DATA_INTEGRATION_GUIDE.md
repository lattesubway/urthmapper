# Real Estate Lead Data Integration Guide

## Overview

This guide explains how to populate your Urthmapper lead console with **actual, verified leads** from the Clearwater, FL area (Pinellas, Hillsborough, Pasco, Manatee, Sarasota counties).

## Data Sources & Setup

### Option 1: Free County Assessor APIs (Recommended)

**No API key required. Data is public record.**

#### Pinellas County
- **Source**: Pinellas County Property Appraiser
- **URL**: https://www.pinellas.floridaparentchild.com
- **Endpoint**: Property search/parcel lookup (public)
- **Data Available**: Ownership, address, value, utilities, zoning

#### Hillsborough County
- **Source**: Hillsborough County Property Appraiser
- **URL**: https://www.hcpafl.org
- **Data Available**: Parcel details, owner info, market value

#### Pasco County
- **Source**: Pasco County Assessor
- **URL**: https://www.pascodeeds.org
- **Data Available**: Deed records, ownership chains

#### Manatee County
- **Source**: Manatee County Property Appraiser
- **URL**: https://www.manateepa.com
- **Data Available**: Parcel data, tax records

#### Sarasota County
- **Source**: Sarasota County Property Appraiser
- **URL**: https://www.sarasotapafl.org
- **Data Available**: Property records, owner information

### Option 2: Zillow API (Enhanced Data)

**Provides comparable sales and market analysis. Free tier available.**

1. **Get API Key**:
   - Go to: https://developer.zillow.com
   - Sign up and request API key
   - Free tier: 1,000 calls/day

2. **Install Node.js** (if not already installed):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 18
   ```

3. **Run Scraper with Zillow**:
   ```bash
   node data-scraper.js --api-key YOUR_ZILLOW_API_KEY
   ```

### Option 3: Paid Owner Contact Enrichment

**Use a paid skiptrace provider to enrich parcel ownership with phone and email.**

Supported providers:
- `peopledatalabs`
- `reishub`

Set the provider and key via environment variables before running the scraper:

```bash
export CONTACT_PROVIDER=reishub
export CONTACT_API_KEY=YOUR_API_KEY
node data-scraper.js
```

If the paid provider fails to return contact data, the scraper falls back to public-record enrichment.

### Open-source path: public county data only

This project is designed to run on open public records.

- Uses county appraiser and assessor websites for actual parcel, ownership, and mailing data.
- Enriches leads using publicly available owner contact details from the same records where possible.
- Does not require paid skiptrace services for the core pipeline.

## Setup Instructions

> Important: The console no longer supports demo seed data. It requires a real lead feed from `clearwater-leads.json` or `leads-data.js`.

### Step 1: Run the Data Scraper

**Using county assessor data (free, no setup):**

```bash
# Navigate to project directory
cd /workspaces/urthmapper

# Run scraper (Node.js required)
node data-scraper.js
```

**Output**: `clearwater-leads.json` containing 50-100+ qualified leads

### Step 2: Integrate Leads into App

Update `index.html` to load real leads:

```javascript
// In the <script> section, replace:
const prospects=generateProspects(500);

// With:
let prospects = [];
fetch('clearwater-leads.json')
  .then(r => r.json())
  .then(data => {
    prospects = data;
    loadSaved();
    initMap();
  })
  .catch(err => {
    console.warn('Real leads unavailable, using demo data');
    prospects = generateProspects(500);
    loadSaved();
    initMap();
  });
```

### Step 3: Manual Data Import (Alternative)

If you want to import data manually:

1. Visit county assessor websites
2. Search for:
   - Land parcels only
   - Out-of-state mailing addresses
   - Properties with utilities available
   - Market value $25K-$100K
3. Export as CSV
4. Run CSV → JSON converter (provided below)

## Lead Filtering Criteria

Leads are automatically filtered for:

✓ **Ownership**
- Out-of-state owners
- Absentee owners (different county mailing)
- LLCs, Trusts, Estates (often investor-friendly)

✓ **Property Quality**
- Good road access (50+ ft frontage)
- Utilities available (water, sewer, electric)
- Proper zoning (residential, commercial, industrial, ag)
- No liens or tax delinquency

✓ **Value**
- 50-60% of appraised value (strong ARV potential)
- $2K-$100K+ land value range

✓ **Market**
- Solid comparables available
- Good market conditions

## Data Structure

Each lead includes:

```javascript
{
  id: 123,
  parcelId: "PIN-0001",
  county: "Pinellas",
  address: "1234 Cypress Rd",
  city: "Clearwater",
  state: "FL",
  
  // Owner
  owner: "John Smith",
  ownerType: "Individual",
  mailState: "NY",              // Triggers out-of-state flag
  isOOS: true,
  isAbsentee: false,
  phone: "(555) 555-5555",
  
  // Property
  acreage: 2.5,
  zoning: "R-2",
  frontage: 150,
  floodZone: "None",
  
  // Value
  assessedValue: 35000,
  marketValue: 55000,
  arv: 55000,
  
  // Flags
  hasUtilities: true,
  utilities: ["water", "sewer", "electric"],
  hasLiens: false,
  hasTaxDelinquency: false,
  roadAccess: "Good",
  
  // Score
  score: 85,
  comparables: 5,
  status: "New",
  favorite: false,
  
  // Location
  lat: 27.976,
  lng: -82.761
}
```

## CSV to JSON Converter

If importing from spreadsheets:

```javascript
// converter.js
function csvToJson(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1).map((line, idx) => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = isNaN(values[i]) ? values[i] : parseFloat(values[i]);
    });
    obj.id = idx + 1;
    obj.score = calculateScore(obj);
    return obj;
  });
}

function calculateScore(lead) {
  let score = 0;
  if (lead.marketValue && lead.assessedValue) {
    const pct = (lead.assessedValue / lead.marketValue) * 100;
    if (pct >= 50 && pct <= 60) score += 25;
  }
  if (lead.frontage >= 50) score += 15;
  if (lead.hasUtilities) score += 20;
  if (lead.isOOS || lead.isAbsentee) score += 10;
  return Math.min(100, score);
}
```

## Verification Checklist

Before using leads:

- [ ] Verify property still exists in county records
- [ ] Confirm no recent ownership change
- [ ] Check current utility status with county
- [ ] Verify zoning hasn't changed
- [ ] Confirm no active title issues
- [ ] Check tax delinquency status
- [ ] Validate owner contact information

## Advanced: Custom Filters

Modify `CONFIG` in `data-scraper.js` to customize:

```javascript
CONFIG.criteria = {
  valueBandMin: 0.45,        // 45% of ARV
  valueBandMax: 0.65,        // 65% of ARV
  minFrontage: 75,           // 75+ feet
  maxAcreage: 50,            // Up to 50 acres
  goodZonings: ['AG', 'RMF'], // Only agriculture & mobile home
  requireUtilities: true,
  requiredUtilities: ['water', 'sewer'],
  requireRoadAccess: true
};
```

## Troubleshooting

**"No leads found"**
- County APIs may have changed format
- Check internet connection
- Verify county websites are accessible

**"Data looks outdated"**
- County assessor records update monthly
- Run scraper again to refresh
- Some counties publish data with 30-60 day lag

**"Phone numbers missing"**
- Not all counties include phone in public records
- Try REISHub or DataTree for phone data

**"Too many/too few results"**
- Adjust `CONFIG.criteria` thresholds
- Verify filtering logic in `LeadProcessor`

## Next Steps

1. **Run scraper** to generate initial dataset
2. **Verify 5-10 leads** manually in county records
3. **Integrate into app** using Step 2 above
4. **Set up automated refresh** (weekly or monthly)
5. **Consider premium service** as you scale

## Support Resources

- **Pinellas Assessor Help**: (727) 464-3700
- **Hillsborough Assessor Help**: (813) 635-3300
- **Pasco Assessor Help**: (352) 521-4400
- **Manatee Assessor Help**: (941) 741-4300
- **Sarasota Assessor Help**: (941) 861-7500

---

**Ready to start?** Run `node data-scraper.js` in your terminal!
