#!/usr/bin/env python3
"""
Urthmapper — Pinellas County Vacant Land Pipeline

Pulls live parcel data from Pinellas County GIS (pcpao.gov / egis.pinellas.gov)
Filters for vacant land, calculates absentee/trust flags, scores leads
Outputs GeoJSON and CSV files matching existing leads format

Usage:
    python3 scraper/pinellas_vacant_land.py
    python3 scraper/pinellas_vacant_land.py --limit 500
"""

import os
import sys
import json
import math
import re
import requests
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple

# Pinellas County ArcGIS REST endpoint
PINELLAS_PARCEL_URL = "https://egis.pinellas.gov/gis/rest/services/PublicWebGIS/Parcels/MapServer/1/query"

# Target cities (Clearwater focus + strong Pinellas leads)
TARGET_CITIES = [
    'CLEARWATER', 'LARGO', 'DUNEDIN', 'SAFETY HARBOR', 'PALM HARBOR',
    'SEMINOLE', 'BELLEAIR', 'BELLEAIR BLUFFS', 'INDIAN ROCKS BEACH',
    'INDIAN SHORES', 'REDINGTON BEACH', 'NORTH REDINGTON BEACH',
    'REDINGTON SHORES', 'MADEIRA BEACH', 'TREASURE ISLAND',
    'ST PETE BEACH', 'SOUTH PASADENA', 'ST PETERSBURG'
]

# Vacant land DOR codes (00xx = vacant, 10xx = vacant with potential, 19xx = other vacant)
VACANT_DOR_PREFIXES = ['00', '10', '19']

# Filter defaults
DEFAULT_FILTERS = {
    'min_land_value': 5000,
    'max_land_value': 250000,
    'min_acres': 0.15,
    'max_acres': 20,
    'min_score': 35
}

MH_ZONINGS = ['MH', 'RMF', 'RM', 'R-MH', 'MHR', 'MOBILE HOME', 'MANUFACTURED']


def is_absentee(situs_city: str, mail_city: str, mail_state: str) -> bool:
    """Returns True if owner is likely absentee"""
    mailing_state = str(mail_state or '').upper().strip()
    situs_city = str(situs_city or '').upper().strip()
    mailing_city = str(mail_city or '').upper().strip()
    
    if mailing_state and mailing_state != 'FL':
        return True
    if mailing_city and situs_city and mailing_city != situs_city:
        return True
    return False


def is_trust_or_estate(owner_name: str) -> bool:
    """Detects motivated seller signals in owner name"""
    if not owner_name:
        return False
    name = str(owner_name).upper()
    keywords = [
        'ESTATE', 'TRUST', 'REVOCABLE', 'IRREVOCABLE', 'HEIR', 'HEIRS',
        'DECEASED', 'ET AL', 'LIVING TRUST', 'FAMILY TRUST', 'PROBATE'
    ]
    return any(kw in name for kw in keywords)


def calculate_lead_score(row: Dict) -> int:
    """Main investor lead score (0-100)"""
    score = 50

    # Tier 1 - Motivation (highest impact)
    if row.get('isOOS') or row.get('isAbsentee'):
        score += 25
    if is_trust_or_estate(row.get('owner', '')):
        score += 20

    # Ownership duration (if available)
    years_owned = row.get('yrsOwned') or 0
    if years_owned >= 10:
        score += 12
    elif years_owned >= 5:
        score += 6

    # Property fundamentals
    acreage = float(row.get('acreage') or 0)
    score += min(12, round(acreage * 6))   # bigger lots = better (capped)

    # Value signals (undervalued potential)
    just_land = float(row.get('landValue') or 0)
    assessed = float(row.get('marketValue') or 0)
    if just_land > 0 and assessed > 0:
        if assessed < (just_land * 0.85):   # assessed significantly below just value
            score += 8

    # Clearwater / strong location bonus
    city = str(row.get('situsAddress', '') if isinstance(row.get('situsAddress'), str) else row.get('situsAddress', {}).get('city', '')).upper()
    if 'CLEARWATER' in city:
        score += 8

    # Flood zone penalty (important in FL)
    flood = str(row.get('floodZone') or '').upper()
    if flood in ['AE', 'VE', 'A', 'V']:
        score -= 10
    elif flood in ['X', 'X500', 'NONE', 'MINIMAL']:
        score += 5

    # Cap and floor
    return max(0, min(100, int(score)))


def get_motivation_flags(row: Dict) -> list:
    """Returns list of human-readable motivation signals"""
    flags = []
    
    if row.get('isOOS'):
        flags.append('Out-of-state owner')
    elif row.get('isAbsentee'):
        flags.append('Absentee owner')
    
    if is_trust_or_estate(row.get('owner', '')):
        flags.append('Trust/Estate owner')
    
    years_owned = row.get('yrsOwned') or 0
    if years_owned >= 10:
        flags.append('10+ years owned')
    elif years_owned >= 5:
        flags.append('5+ years owned')
    
    city = str(row.get('situsAddress', '') if isinstance(row.get('situsAddress'), str) else row.get('situsAddress', {}).get('city', '')).upper()
    if 'CLEARWATER' in city:
        flags.append('Clearwater location')
    
    acreage = float(row.get('acreage') or 0)
    if acreage >= 5:
        flags.append(f'{acreage:.1f} acre lot')
    
    return flags


def classify_owner_type(name: str) -> str:
    """Classify owner type based on name patterns."""
    if not name:
        return 'Individual'
    
    upper = name.upper()
    
    if re.search(r'\bLLC\b|\bL\.L\.C\b', upper):
        return 'LLC'
    if re.search(r'\bTRUST\b', upper):
        return 'Trust'
    if re.search(r'\bESTATE\b|\bHEIRS?\b', upper):
        return 'Estate'
    if re.search(r'\bINC\b|\bCORP\b|\bCOMPANY\b|\bCO\b|\bLP\b|\bLLP\b', upper):
        return 'Corporate'
    if re.search(r'\bHEIRS?\b', upper):
        return 'Heirs'
    
    return 'Individual'


def is_vacant_dor(code: str) -> bool:
    """Check if DOR code indicates vacant land."""
    if not code:
        return False
    normalized = str(code).strip()
    return any(normalized.startswith(prefix) for prefix in VACANT_DOR_PREFIXES)


def is_vacant_by_use(use_code: str, land_use: str = '') -> bool:
    """Check if property is vacant based on use codes or land use description."""
    if not use_code and not land_use:
        return False
    
    use_upper = str(use_code).upper()
    land_upper = str(land_use).upper()
    
    # DOR vacant codes
    if is_vacant_dor(use_code):
        return True
    
    # Check land use descriptions for vacant indicators
    vacant_keywords = ['VACANT', 'UNIMPROVED', 'RAW LAND', 'LOT', 'TRACT']
    improved_keywords = ['SINGLE FAMILY', 'CONDO', 'APARTMENT', 'COMMERCIAL', 'INDUSTRIAL', 'RETAIL', 'OFFICE']
    
    # If it mentions vacant/unimproved without improved keywords
    has_vacant = any(kw in land_upper for kw in vacant_keywords)
    has_improved = any(kw in land_upper for kw in improved_keywords)
    
    return has_vacant and not has_improved


def calculate_frontage(geometry: Dict) -> float:
    """Estimate frontage from geometry (simplified)."""
    if not geometry:
        return 0
    
    # For polygons, estimate frontage from perimeter
    if geometry.get('type') == 'polygon':
        rings = geometry.get('rings', [])
        if rings and rings[0]:
            # Simplified: use perimeter / 4 as rough frontage estimate
            perimeter = 0
            ring = rings[0]
            for i in range(len(ring) - 1):
                x1, y1 = ring[i]
                x2, y2 = ring[i + 1]
                perimeter += math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
            # Convert from meters to feet if needed, then estimate frontage
            return max(0, perimeter / 4 * 3.28)  # Rough estimate in feet
    
    return 0


def get_centroid(geometry: Dict) -> Tuple[Optional[float], Optional[float]]:
    """Extract centroid coordinates from geometry."""
    if not geometry:
        return None, None
    
    geom_type = geometry.get('type', '').lower()
    
    if geom_type == 'point':
        return geometry.get('x'), geometry.get('y')
    
    if geom_type == 'polygon' or geom_type == 'esrigeometrypolygon':
        rings = geometry.get('rings', [])
        if rings and rings[0]:
            ring = rings[0]
            avg_x = sum(p[0] for p in ring) / len(ring)
            avg_y = sum(p[1] for p in ring) / len(ring)
            return avg_x, avg_y
    
    # Handle multipoint
    if geom_type == 'multipoint':
        points = geometry.get('points', [])
        if points:
            avg_x = sum(p[0] for p in points) / len(points)
            avg_y = sum(p[1] for p in points) / len(points)
            return avg_x, avg_y
    
    return None, None


def is_absentee_owner(situs_city: str, mail_city: str, mail_state: str) -> bool:
    """Determine if owner is absentee (mailing address differs from situs)."""
    if not situs_city or not mail_city:
        return False
    
    situs_upper = situs_city.upper().strip()
    mail_upper = mail_city.upper().strip()
    mail_state_upper = (mail_state or 'FL').upper().strip()
    
    # Out of state is always absentee
    if mail_state_upper and mail_state_upper != 'FL':
        return True
    
    # Different cities within Florida
    return situs_upper != mail_upper


def score_lead(lead: Dict) -> Tuple[int, List[str]]:
    """Calculate lead score using standard investor criteria."""
    score = calculate_lead_score(lead)
    flags = get_motivation_flags(lead)
    
    # Build breakdown
    breakdown = []
    if lead.get('isOOS') or lead.get('isAbsentee'):
        breakdown.append('Absentee/OOS owner (+25)')
    if is_trust_or_estate(lead.get('owner', '')):
        breakdown.append('Trust/Estate owner (+20)')
    
    acreage = float(lead.get('acreage') or 0)
    if acreage >= 2:
        breakdown.append(f'Larger lot {acreage:.1f}ac (+{min(12, round(acreage * 6))})')
    
    city = str(lead.get('situsAddress', '') if isinstance(lead.get('situsAddress'), str) else lead.get('situsAddress', {}).get('city', '')).upper()
    if 'CLEARWATER' in city:
        breakdown.append('Clearwater location (+8)')
    
    flood = str(lead.get('floodZone') or '').upper()
    if flood in ['AE', 'VE', 'A', 'V']:
        breakdown.append('High-risk flood zone (-10)')
    elif flood in ['X', 'X500', 'NONE', 'MINIMAL']:
        breakdown.append('Low flood risk (+5)')
    
    return score, breakdown


def query_pinellas_parcels(
    where_clause: str,
    limit: int = 1000,
    offset: int = 0
) -> List[Dict]:
    """Query Pinellas County parcel data via ArcGIS REST API."""
    params = {
        'where': where_clause,
        'outFields': '*',
        'returnGeometry': 'true',
        'outSR': '4326',
        'f': 'json',
        'resultOffset': offset,
        'resultRecordCount': min(limit, 1000)
    }
    
    try:
        response = requests.get(PINELLAS_PARCEL_URL, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        if 'error' in data:
            print(f"  API Error: {data['error']}")
            return []
        
        return data.get('features', [])
    
    except requests.RequestException as e:
        print(f"  Request failed: {e}")
        return []


def parse_pinellas_feature(feature: Dict) -> Optional[Dict]:
    """Parse a Pinellas County parcel feature into standardized format."""
    attrs = feature.get('attributes', {})
    geometry = feature.get('geometry', {})
    
    # Extract owner name
    owner_parts = [attrs.get('OWNER1', ''), attrs.get('OWNER2', '')]
    owner = ' '.join(p for p in owner_parts if p).strip()
    
    # Extract situs address
    site_street = ' '.join(p for p in [attrs.get('SITE_NUM', ''), attrs.get('SITE_ADDRESS', '')] if p).strip()
    site_city = (attrs.get('SITE_CITY', '') or '').strip()
    site_state = (attrs.get('SITE_STATE', '') or 'FL').strip()
    site_zip = (attrs.get('SITE_ZIP', '') or '').strip()
    
    # Extract mailing address
    mail_line1 = (attrs.get('OWNADD_1', '') or '').strip()
    mail_line2 = (attrs.get('OWNADD_2', '') or '').strip()
    mail_city = (attrs.get('OWNCITY', '') or '').strip()
    mail_state = (attrs.get('OWNSTATE', '') or '').strip()
    mail_zip = (attrs.get('OWNZIP', '') or '').strip()
    
    # Build addresses
    situs_full = ', '.join(p for p in [site_street, site_city, site_state, site_zip] if p)
    mail_full = ', '.join(p for p in [mail_line1, mail_line2, mail_city, mail_state, mail_zip] if p)
    
    # Get values
    land_value = float(attrs.get('LAND_VALUE', 0) or 0)
    imp_value = float(attrs.get('IMP_VALUE', 0) or 0)
    taxable_value = float(attrs.get('TAXABLE_VALUE', 0) or 0)
    acres = float(attrs.get('Acres', 0) or 0)
    
    # Get codes and descriptions
    dor_code = (attrs.get('USE_CODE', '') or '').strip()
    land_use = (attrs.get('LEGAL', '') or '').strip()
    zoning = (attrs.get('ZONING', '') or attrs.get('USE_CODE', '') or 'Unknown').strip()
    
    # Check if vacant
    is_vacant = is_vacant_dor(dor_code) or is_vacant_by_use(dor_code, land_use)
    if not is_vacant:
        # Also check if improvement value is 0 (no structures)
        is_vacant = imp_value == 0 and is_vacant_by_use('', land_use)
    
    if not is_vacant:
        return None
    
    # Determine absentee status
    is_oos = mail_state and mail_state.upper() != 'FL'
    is_absentee = is_absentee_owner(site_city, mail_city, mail_state)
    
    # Get geometry centroid
    lat, lng = get_centroid(geometry)
    
    # Estimate frontage
    frontage = calculate_frontage(geometry)
    
    # Parse sale data
    sale_date = attrs.get('SALEDATE1', '')
    sale_price = float(attrs.get('SALEPRICE1', 0) or 0)
    
    return {
        'county': 'Pinellas',
        'parcelId': (attrs.get('PARCELID_DSP1') or attrs.get('PARCELID') or attrs.get('STRAP', '')),
        'owner': owner,
        'ownerType': classify_owner_type(owner),
        'situsAddress': {
            'street': site_street,
            'city': site_city,
            'state': site_state,
            'zip': site_zip,
            'full': situs_full
        },
        'mailingAddress': {
            'line1': mail_line1,
            'line2': mail_line2,
            'city': mail_city,
            'state': mail_state,
            'zip': mail_zip,
            'full': mail_full
        },
        'acreage': acres,
        'landValue': land_value,
        'improvementValue': imp_value,
        'marketValue': taxable_value or land_value,
        'zoning': zoning,
        'dorCode': dor_code,
        'landUseDescription': land_use,
        'frontage': round(frontage, 1) if frontage else 0,
        'saleDate': sale_date if sale_date else None,
        'salePrice': sale_price if sale_price else None,
        'isOOS': is_oos,
        'isAbsentee': is_absentee,
        'lat': lat,
        'lng': lng,
        'geometry': geometry,
        'dataSource': 'Pinellas County GIS',
        'scrapedAt': datetime.now().isoformat()
    }


def fetch_vacant_parcels(
    cities: List[str] = None,
    min_land_value: float = 5000,
    max_land_value: float = 250000,
    min_acres: float = 0.15,
    max_acres: float = 20,
    limit: int = 1000
) -> List[Dict]:
    """Fetch vacant land parcels from Pinellas County."""
    
    cities = cities or TARGET_CITIES
    
    # Build WHERE clause - focus on vacant land with IMP_VALUE = 0
    # Use simpler query first, then filter in Python
    city_list = "', '".join(cities)
    where_parts = [
        f"SITE_CITY IN ('{city_list}')",
        "IMP_VALUE = 0",  # No improvements = vacant
        f"LAND_VALUE >= {min_land_value}",
        f"LAND_VALUE <= {max_land_value}",
        f"Acres >= {min_acres}",
        f"Acres <= {max_acres}"
    ]
    
    where_clause = ' AND '.join(where_parts)
    
    print(f"\n📍 Pinellas County: querying pcpao.gov GIS...")
    print(f"   Cities: {', '.join(cities[:5])}... ({len(cities)} total)")
    print(f"   WHERE: {where_clause[:120]}...")
    print(f"   Limits: Land ${min_land_value}-${max_land_value}, Acres {min_acres}-{max_acres}")
    
    all_features = []
    offset = 0
    batch_size = 1000
    
    while len(all_features) < limit:
        remaining = limit - len(all_features)
        features = query_pinellas_parcels(where_clause, limit=min(batch_size, remaining), offset=offset)
        
        if not features:
            break
        
        all_features.extend(features)
        offset += len(features)
        
        print(f"   Fetched {len(all_features)} parcels...")
        
        if len(features) < batch_size:
            break  # No more results
    
    return all_features


def process_parcels(features: List[Dict]) -> List[Dict]:
    """Parse and filter parcel features."""
    parcels = []
    
    for feature in features:
        parcel = parse_pinellas_feature(feature)
        if parcel:
            parcels.append(parcel)
    
    return parcels


def enrich_parcels(parcels: List[Dict]) -> List[Dict]:
    """Add calculated fields and scores to parcels."""
    enriched = []
    
    for parcel in parcels:
        # Calculate price per acre
        acreage = parcel.get('acreage', 0) or 0.001  # Avoid division by zero
        land_value = parcel.get('landValue', 0) or 0
        parcel['pricePerAcre'] = round(land_value / acreage, 2) if acreage > 0 else 0
        
        # Calculate buildable acres (estimate: 80% of total for vacant land)
        parcel['buildableAcres'] = round(acreage * 0.8, 2)
        
        # === EXACT FIELD ASSIGNMENTS AS SPECIFIED ===
        parcel['is_absentee'] = is_absentee(
            parcel.get('situsAddress', {}).get('city', ''),
            parcel.get('mailingAddress', {}).get('city', ''),
            parcel.get('mailingAddress', {}).get('state', '')
        )
        parcel['is_trust_or_estate'] = is_trust_or_estate(parcel.get('owner', ''))
        parcel['lead_score'] = calculate_lead_score(parcel)
        parcel['motivation_flags'] = get_motivation_flags(parcel)
        # =============================================
        
        # Determine owner signals
        owner_type = parcel.get('ownerType', '')
        parcel['investorSignals'] = parcel['motivation_flags'].copy()
        if owner_type in ['LLC', 'Trust', 'Estate', 'Heirs', 'Corporate']:
            parcel['investorSignals'].append(f'{owner_type} owner')
        if land_value <= 25000:
            parcel['investorSignals'].append('Low land value')
        
        # Risk flags
        parcel['riskFlags'] = []
        if parcel.get('hasTaxDelinquency'):
            parcel['riskFlags'].append('Tax delinquent')
        
        # Calculate score (also store as 'score' for backward compatibility)
        score, breakdown = score_lead(parcel)
        parcel['score'] = score
        parcel['scoreBreakdown'] = breakdown
        
        # Default values for compatibility
        parcel['phone'] = None
        parcel['email'] = None
        parcel['floodZone'] = 'Unknown'
        parcel['inSFHA'] = False
        parcel['waterFeatures'] = []
        parcel['zoningCategory'] = 'Unknown'
        parcel['zoningDescription'] = parcel.get('zoning', 'Unknown')
        parcel['allowsMobileHome'] = any(mh in (parcel.get('zoning') or '').upper() for mh in MH_ZONINGS)
        parcel['landUseLabel'] = 'Vacant Land'
        parcel['estAnnualTax'] = round(land_value * 0.015, 2)  # Estimate
        parcel['wholesaleOfferEst'] = round(land_value * 0.6, 2)  # Estimate
        parcel['arv'] = None
        parcel['yrsOwned'] = None
        parcel['ownerParcelCount'] = 1
        parcel['multiParcel'] = False
        parcel['isPortfolioOwner'] = False
        parcel['nearestRoad'] = None
        parcel['roadAccess'] = 'Unknown'
        parcel['legalAccess'] = 'Unknown'
        parcel['distToHighwayMi'] = None
        parcel['highwayName'] = None
        parcel['distHospitalMi'] = None
        parcel['distSchoolMi'] = None
        parcel['distGroceryMi'] = None
        parcel['developmentPotential'] = 'Medium'
        parcel['estSubdivisionLots'] = max(1, int(acreage / 0.25))  # Estimate
        parcel['hasWetlandsNearby'] = False
        parcel['hasLiens'] = False
        parcel['status'] = 'New'
        parcel['favorite'] = False
        
        enriched.append(parcel)
    
    return enriched


def export_geojson(parcels: List[Dict], output_path: str):
    """Export parcels as GeoJSON with Point features."""
    features = []
    
    for parcel in parcels:
        lat = parcel.get('lat')
        lng = parcel.get('lng')
        
        # Create Point geometry
        if lat and lng:
            geometry = {
                'type': 'Point',
                'coordinates': [lng, lat]
            }
        else:
            # Use polygon geometry if available
            geometry = parcel.get('geometry', {'type': 'Point', 'coordinates': [0, 0]})
        
        # Clean properties for GeoJSON (remove nested objects that don't serialize well)
        props = parcel.copy()
        props['situsAddress'] = parcel.get('situsAddress', {}).get('full', '')
        props['mailingAddress'] = parcel.get('mailingAddress', {}).get('full', '')
        props.pop('geometry', None)
        
        feature = {
            'type': 'Feature',
            'geometry': geometry,
            'properties': props
        }
        features.append(feature)
    
    geojson = {
        'type': 'FeatureCollection',
        'features': features,
        'metadata': {
            'generatedAt': datetime.now().isoformat(),
            'source': 'Pinellas County GIS',
            'totalCount': len(features)
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"✅ GeoJSON exported: {output_path}")


def export_csv(parcels: List[Dict], output_path: str):
    """Export parcels as CSV matching existing leads format."""
    columns = [
        ('id', 'ID'),
        ('parcelId', 'Parcel ID'),
        ('county', 'County'),
        ('owner', 'Owner'),
        ('ownerType', 'Owner Type'),
        ('situsAddress', 'Situs Address'),
        ('address', 'Street'),
        ('city', 'City'),
        ('state', 'State'),
        ('mailingAddress', 'Mailing Address'),
        ('mailState', 'Mail State'),
        ('isOOS', 'Out of State'),
        ('isAbsentee', 'Absentee'),
        ('phone', 'Phone'),
        ('email', 'Email'),
        ('acreage', 'Acreage'),
        ('buildableAcres', 'Buildable Acres'),
        ('frontage', 'Frontage (ft)'),
        ('zoning', 'Zoning'),
        ('dorCode', 'DOR Code'),
        ('floodZone', 'Flood Zone'),
        ('landValue', 'Land Value'),
        ('pricePerAcre', 'Price/Acre'),
        ('marketValue', 'Market Value'),
        ('estAnnualTax', 'Est Annual Tax'),
        ('score', 'Appeal Score'),
        ('investorSignals', 'Investor Signals'),
        ('riskFlags', 'Risk Flags'),
        ('scoreBreakdown', 'Score Breakdown'),
        ('lat', 'Latitude'),
        ('lng', 'Longitude'),
        ('dataSource', 'Data Source'),
        ('scrapedAt', 'Scraped At')
    ]
    
    def cell_value(value):
        if value is None:
            return ''
        if isinstance(value, bool):
            return 'Yes' if value else 'No'
        if isinstance(value, list):
            return '; '.join(str(v) for v in value)
        if isinstance(value, dict):
            return value.get('full', str(value))
        if isinstance(value, (int, float)) and value > 1e11:
            return datetime.fromtimestamp(value / 1000).strftime('%Y-%m-%d')
        return str(value)
    
    def escape_csv(value):
        text = cell_value(value)
        return f'"{text.replace(chr(34), chr(34) + chr(34))}"'
    
    header = ','.join(escape_csv(label) for _, label in columns)
    
    rows = []
    for i, parcel in enumerate(parcels, 1):
        parcel['id'] = i
        row = []
        for key, _ in columns:
            value = parcel.get(key, '')
            if key == 'situsAddress':
                value = parcel.get('situsAddress', {}).get('full', '')
            elif key == 'mailingAddress':
                value = parcel.get('mailingAddress', {}).get('full', '')
            row.append(escape_csv(value))
        rows.append(','.join(row))
    
    with open(output_path, 'w') as f:
        f.write(header + '\n')
        f.write('\n'.join(rows))
    
    print(f"✅ CSV exported: {output_path}")


def main():
    """Main pipeline execution."""
    args = sys.argv[1:]
    
    limit = 1000
    for i, arg in enumerate(args):
        if arg == '--limit' and i + 1 < len(args):
            limit = int(args[i + 1])
    
    print("=" * 60)
    print("URTHMAPPER — Pinellas County Vacant Land Pipeline")
    print("=" * 60)
    
    # Fetch vacant parcels
    features = fetch_vacant_parcels(limit=limit)
    
    if not features:
        print("\n❌ No parcels found matching criteria")
        sys.exit(1)
    
    # Parse and filter
    parcels = process_parcels(features)
    print(f"\n   ✓ {len(features)} raw parcels → {len(parcels)} vacant land parcels")
    
    # Enrich with scores and calculated fields
    parcels = enrich_parcels(parcels)
    
    # Sort by score (highest first)
    parcels.sort(key=lambda p: (-p['score'], p['landValue']))
    
    # Assign IDs
    for i, parcel in enumerate(parcels, 1):
        parcel['id'] = i
    
    # Calculate statistics
    total = len(parcels)
    clearwater_parcels = [p for p in parcels if p['situsAddress'].get('city', '').upper() == 'CLEARWATER']
    clearwater_count = len(clearwater_parcels)
    absentee_count = sum(1 for p in parcels if p.get('isAbsentee') or p.get('isOOS'))
    absentee_pct = round(100 * absentee_count / total, 1) if total > 0 else 0
    
    # Export files
    os.makedirs('data', exist_ok=True)
    
    geojson_path = 'data/pinellas_clearwater_vacant_leads.geojson'
    csv_path = 'data/pinellas_vacant_leads.csv'
    
    export_geojson(parcels, geojson_path)
    export_csv(parcels, csv_path)
    
    # Print summary
    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE — SUMMARY")
    print("=" * 60)
    print(f"\n📊 Total vacant leads generated: {total}")
    print(f"🏙️  Clearwater area leads: {clearwater_count}")
    print(f"📬 Absentee owners: {absentee_count} ({absentee_pct}%)")
    
    # Sample high-score Clearwater leads
    high_score_clearwater = [
        p for p in clearwater_parcels if p['score'] >= 50
    ][:3]
    
    if high_score_clearwater:
        print("\n🎯 Sample High-Score Clearwater Leads:")
        print("-" * 60)
        for lead in high_score_clearwater:
            print(f"  • Owner: {lead['owner'][:40]}...")
            print(f"    Acreage: {lead['acreage']:.2f} | Land Value: ${lead['landValue']:,.0f}")
            print(f"    Score: {lead['score']} | Absentee: {'Yes' if lead['isAbsentee'] else 'No'}")
            print(f"    Address: {lead['situsAddress'].get('full', 'N/A')}")
            print()
    
    print(f"\n📁 Output Files:")
    print(f"   1. {os.path.abspath(geojson_path)}")
    print(f"   2. {os.path.abspath(csv_path)}")
    
    print("\n" + "=" * 60)


if __name__ == '__main__':
    main()
