/**
 * Database table schemas for deals, dealership_car, and dealership tables.
 */

export interface OwnerDetails {
    id?: string;
    email?: string;
}

export interface DealershipLocation {
    geopoint?: string; // PostGIS POINT string format: "POINT(longitude latitude)" e.g. "POINT(8.552376 60.8630648)"
    zipcode?: string;
    address?: string;
    country?: number;
    muncipality?: number;
}

export interface Dealership {
    id: string; // uuid
    created_at: Date;
    name?: string;
    image?: string;
    owner_details?: OwnerDetails;
    status?: string;
    is_archived?: boolean;
    is_approved?: boolean;
    company_name?: string;
    phone_number?: number;
    country_code?: string;
    organization_number?: number;
    type?: string;
    organization_id?: number;
    location?: DealershipLocation;
    website?: string;
}

export interface CarMake {
    id: number;
    name: string;
}

export interface CarModel {
    id: number;
    name: string;
}

export interface CarMedia {
    storage?: string;
    filename?: string;
    filepath?: string;
}

export interface Inclusion {
    id: number;
    [key: string]: unknown; // Allow for additional fields from xdo JSONB
}

export interface DealershipCar {
    id: string; // uuid
    created_at: Date;
    internal_label?: string;
    make?: string;
    make_id?: number;
    model?: string;
    model_id?: number;
    model_variant?: string;
    vin?: string;
    registration_date?: Date;
    registration_number?: string;
    dealership_id: string; // uuid
    status?: string;
    sale_status?: string;
    hitme?: boolean;
    door?: number;
    seat?: number;
    transmission?: string;
    fuel?: string;
    body?: string;
    color?: string;
    tax_class?: string;
    description?: string;
    mileage?: number;
    weight?: number;
    batterycap?: number;
    horsepower?: number;
    spec?: number[];
    wheel_drive?: string;
    image?: string;
    media?: CarMedia;
}

export interface Deal {
    id: string; // uuid
    created_at: Date;
    internal_label?: string;
    monthly_price?: number;
    pricing_frequency?: string;
    deposit?: number;
    status?: string;
    sale_status?: string;
    insurance?: boolean;
    hitme?: boolean;
    delivery_method?: string;
    description?: string;
    mileage?: number;
    yearly_mileage?: number;
    lease_frequency?: string;
    lease_period?: number;
    inclusion?: Inclusion[];
    dealership_id: string; // uuid
    dealership_car_id: string; // uuid
}

export interface DealWithCarDetails extends Deal {
    car?: DealershipCar; // Car details nested in car object
    distance?: number | null; // Distance in kilometers (only included when location filter is used, null if no geopoint)
    city?: string | null; // City name from municipality (only included when location filter or city filter is used, null if no municipality)
    region?: string | null; // Region name from country (only included when city filter or region filter is used, null if no country)
    favourite?: boolean; // Whether the deal is favorited by the current user (defaults to false)
    request_count?: number; // Count of records from x1_39 where deal_id matches and source = 'marketplace'
}

export interface LocationFilter {
    lat: number;
    long: number;
    radius?: number; // Radius in kilometers - filter deals within this distance
}

export interface DealFilters {
    deal_id?: string; // uuid
    dealership_car_id?: string; // uuid
    dealership_id?: string; // uuid
    internal_label?: string;
    status?: string;
    sale_status?: string;
    insurance?: boolean;
    hitme?: boolean;
    delivery_method?: string;
    monthly_price?: number[]; // [min, max] range for monthly_price
    deposit?: number[]; // [min, max] range for deposit
    mileage?: number[]; // [min, max] range for deal mileage
    lease_frequency?: string;
    lease_period?: number[]; // [min, max] range for lease_period
    inclusion?: number[]; // Array of numbers to filter by inclusion (array overlap)
    created_at_from?: Date | string;
    created_at_to?: Date | string;
    make?: number[]; // Array of make IDs
    model?: number[]; // Array of model IDs
    transmission?: string[]; // Array of transmission values
    fuel?: string[]; // Array of fuel values
    body?: string[]; // Array of body values
    color?: string[]; // Array of color values
    city?: number[]; // Array of municipality IDs (filters by municipality ID)
    region?: number[]; // Array of region IDs (filters by region ID)
    seat?: number[]; // Array of seat values
    seat_range?: number[]; // [min, max] range for seat count
    tax_class?: string[]; // Array of tax_class values
    wheel_drive?: string[]; // Array of wheel_drive values
    spec?: number[]; // Array of spec IDs (array overlap with car spec field)
    min_mileage_car?: number; // Filter by car mileage
    max_mileage_car?: number; // Filter by car mileage
    batterycap?: (number | null)[]; // [min, max] range for batterycap, null values allowed: [value1, null] = >= value1, [null, value2] = <= value2
    page?: number;
    perPage?: number;
    location?: LocationFilter; // Location object with lat and long
    sort?: string | null; // Sort option: "monthly_price_asc", "monthly_price_desc", "deposit_asc", "deposit_desc", "mileage_asc", "mileage_desc", "registration_year_asc", "registration_year_desc", "published_asc", "published_desc"
}

export interface PaginatedDealsResult {
    items: DealWithCarDetails[];
    curPage: number;
    nextPage: number | null;
    prevPage: number | null;
    total: number;
    perPage: number;
    totalPages: number;
}

