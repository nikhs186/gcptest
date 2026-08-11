"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDealFilters = void 0;
/**
 * Parses query parameters from Express request and converts them to DealFilters.
 * Handles arrays, numbers, booleans, and nested objects.
 * Supports filters passed in a 'data' field or as individual query parameters.
 *
 * @param {Request} req Express request object.
 * @return {DealFilters & {hasNoFilter: boolean}} Parsed filters object with hasNoFilter flag indicating if any meaningful filters are present.
 */
const parseDealFilters = (req) => {
    const query = req.query;
    const filters = {};
    let dataFilters = {};
    let hasDataFilters = false;
    // First, parse individual query parameters (including pagination)
    // This ensures page/perPage from individual params are captured first
    // Check if filters are passed in a 'data' field
    if (query.data) {
        try {
            let dataValue;
            if (typeof query.data === "string") {
                // Try parsing as JSON first
                try {
                    dataValue = JSON.parse(query.data);
                }
                catch (_a) {
                    // If not valid JSON, try URL decoding
                    try {
                        dataValue = JSON.parse(decodeURIComponent(query.data));
                    }
                    catch (_b) {
                        // Keep as string if parsing fails
                        dataValue = query.data;
                    }
                }
            }
            else if (Array.isArray(query.data)) {
                // If it's an array, take the first element
                dataValue = query.data[0];
                if (typeof dataValue === "string") {
                    const dataString = dataValue;
                    try {
                        dataValue = JSON.parse(dataString);
                    }
                    catch (_c) {
                        try {
                            dataValue = JSON.parse(decodeURIComponent(dataString));
                        }
                        catch (_d) {
                            // Keep as string
                        }
                    }
                }
            }
            else if (query.data && typeof query.data === "object" && !Array.isArray(query.data)) {
                // Already an object (Express might have parsed it)
                dataValue = query.data;
            }
            if (dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)) {
                // Parse filters from data field
                const parsedFilters = parseFiltersFromObject(dataValue);
                console.log("parseDealFilters - Parsed from data field:", {
                    originalData: dataValue,
                    parsedFilters,
                    page: parsedFilters.page,
                    perPage: parsedFilters.perPage,
                });
                // Check if data field has any meaningful filters (excluding pagination)
                // A filter is meaningful if it has a non-empty value
                hasDataFilters = Object.keys(parsedFilters).some((key) => {
                    if (key === "page" || key === "perPage")
                        return false;
                    const value = parsedFilters[key];
                    if (value === undefined || value === null)
                        return false;
                    // Check if array is non-empty
                    if (Array.isArray(value))
                        return value.length > 0;
                    // Check if string is non-empty
                    if (typeof value === "string")
                        return value.length > 0;
                    // Check if object has properties
                    if (typeof value === "object")
                        return Object.keys(value).length > 0;
                    // For numbers, booleans, etc., consider them meaningful if they exist
                    return true;
                });
                // Store data filters (will be merged later, but pagination from individual params takes precedence)
                dataFilters = parsedFilters;
            }
            else if (dataValue !== null && dataValue !== undefined) {
                // Log if we got a value but couldn't parse it as an object
                console.warn("Data field value is not a valid object:", typeof dataValue, dataValue);
                // Return empty filters if data field is invalid
                return { hasNoFilter: true };
            }
        }
        catch (error) {
            // Invalid JSON or parsing error, return empty filters
            console.error("Error parsing data filter:", error);
            return { hasNoFilter: true };
        }
    }
    // If no data field is present, fall back to individual query parameters for backward compatibility
    // Simple string fields
    if (query.deal_id && typeof query.deal_id === "string") {
        filters.deal_id = query.deal_id;
    }
    if (query.dealership_car_id && typeof query.dealership_car_id === "string") {
        filters.dealership_car_id = query.dealership_car_id;
    }
    if (query.dealership_id && typeof query.dealership_id === "string") {
        filters.dealership_id = query.dealership_id;
    }
    if (query.internal_label && typeof query.internal_label === "string") {
        filters.internal_label = query.internal_label;
    }
    if (query.status && typeof query.status === "string") {
        filters.status = query.status;
    }
    if (query.sale_status && typeof query.sale_status === "string") {
        filters.sale_status = query.sale_status;
    }
    if (query.delivery_method && typeof query.delivery_method === "string") {
        filters.delivery_method = query.delivery_method;
    }
    if (query.lease_frequency && typeof query.lease_frequency === "string") {
        filters.lease_frequency = query.lease_frequency;
    }
    if (query.body) {
        filters.body = parseStringArray(query.body);
    }
    // Boolean fields
    if (query.insurance !== undefined) {
        const insuranceValue = String(query.insurance);
        filters.insurance = insuranceValue === "true" || insuranceValue === "1";
    }
    if (query.hitme !== undefined) {
        const hitmeValue = String(query.hitme);
        filters.hitme = hitmeValue === "true" || hitmeValue === "1";
    }
    // Number arrays (range filters)
    if (query.monthly_price) {
        filters.monthly_price = parseNumberArray(query.monthly_price);
    }
    if (query.deposit) {
        filters.deposit = parseNumberArray(query.deposit);
    }
    if (query.mileage) {
        filters.mileage = parseNumberArray(query.mileage);
    }
    if (query.lease_period) {
        filters.lease_period = parseNumberArray(query.lease_period);
    }
    if (query.batterycap) {
        filters.batterycap = parseBatterycapArray(query.batterycap);
    }
    // Number arrays (filter arrays)
    if (query.make) {
        filters.make = parseNumberArray(query.make);
    }
    if (query.model) {
        filters.model = parseNumberArray(query.model);
    }
    if (query.seat) {
        filters.seat = parseNumberArray(query.seat);
    }
    if (query.inclusion) {
        filters.inclusion = parseNumberArray(query.inclusion);
    }
    if (query.spec) {
        filters.spec = parseNumberArray(query.spec);
    }
    // String arrays
    if (query.transmission) {
        filters.transmission = parseStringArray(query.transmission);
    }
    if (query.fuel) {
        filters.fuel = parseStringArray(query.fuel);
    }
    if (query.color) {
        filters.color = parseStringArray(query.color);
    }
    if (query.body) {
        filters.body = parseStringArray(query.body);
    }
    if (query.city) {
        filters.city = parseNumberArray(query.city);
    }
    if (query.region) {
        filters.region = parseNumberArray(query.region);
    }
    if (query.tax_class) {
        filters.tax_class = parseStringArray(query.tax_class);
    }
    if (query.wheel_drive) {
        filters.wheel_drive = parseStringArray(query.wheel_drive);
    }
    // Date fields
    if (query.created_at_from && typeof query.created_at_from === "string") {
        filters.created_at_from = query.created_at_from;
    }
    if (query.created_at_to && typeof query.created_at_to === "string") {
        filters.created_at_to = query.created_at_to;
    }
    // Car mileage range
    if (query.min_mileage_car !== undefined) {
        const val = parseFloat(String(query.min_mileage_car));
        if (!isNaN(val)) {
            filters.min_mileage_car = val;
        }
    }
    if (query.max_mileage_car !== undefined) {
        const val = parseFloat(String(query.max_mileage_car));
        if (!isNaN(val)) {
            filters.max_mileage_car = val;
        }
    }
    // Pagination
    if (query.page !== undefined) {
        // Handle case where query.page might be an array (Express behavior)
        const pageValue = Array.isArray(query.page) ? query.page[0] : query.page;
        const val = parseInt(String(pageValue), 10);
        console.log("parseDealFilters - Individual query param page parsing:", {
            original: query.page,
            pageValue,
            type: typeof pageValue,
            parsed: val,
            isValid: !isNaN(val) && val > 0,
        });
        if (!isNaN(val) && val > 0) {
            filters.page = Math.floor(val); // Ensure it's always an integer, not float
            console.log("parseDealFilters - Set filters.page to:", filters.page, "type:", typeof filters.page);
        }
        else {
            console.log("parseDealFilters - Failed to parse page, val:", val);
        }
    }
    else {
        console.log("parseDealFilters - query.page is undefined");
    }
    if (query.perPage !== undefined) {
        // Handle case where query.perPage might be an array (Express behavior)
        const perPageValue = Array.isArray(query.perPage) ? query.perPage[0] : query.perPage;
        const val = parseInt(String(perPageValue), 10);
        if (!isNaN(val) && val > 0) {
            filters.perPage = Math.floor(val); // Ensure it's always an integer, not float
        }
    }
    // Sort parameter
    if (query.sort !== undefined && query.sort !== null) {
        const sortValue = String(query.sort);
        // Validate sort value
        const validSortValues = [
            "monthly_price_asc", "monthly_price_desc",
            "deposit_asc", "deposit_desc",
            "mileage_asc", "mileage_desc",
            "registration_year_asc", "registration_year_desc",
            "published_asc", "published_desc",
        ];
        if (validSortValues.includes(sortValue) || sortValue === "null" || sortValue === "") {
            filters.sort = sortValue === "null" || sortValue === "" ? null : sortValue;
        }
    }
    // Location object - can be passed as:
    // 1. Query parameter: ?location={"lat":21.113434,"lng":79.098813}
    // 2. Flat parameters: ?lat=21.113434&lng=79.098813
    // 3. Flat parameters: ?lat=21.113434&long=79.098813
    if (query.location) {
        try {
            let location;
            if (typeof query.location === "string") {
                // Try parsing as JSON first
                try {
                    location = JSON.parse(query.location);
                }
                catch (_e) {
                    // If not valid JSON, try parsing as URL-encoded string
                    location = query.location;
                }
            }
            else if (Array.isArray(query.location)) {
                // If it's an array, take the first element
                location = query.location[0];
                if (typeof location === "string") {
                    try {
                        location = JSON.parse(location);
                    }
                    catch (_f) {
                        // Keep as string
                    }
                }
            }
            else {
                // Convert query parameter to plain object
                location = query.location;
            }
            if (location && typeof location === "object" && !Array.isArray(location)) {
                const loc = location;
                // Support lat, latitude, lng, long, longitude
                const lat = parseFloat(String(loc.lat || loc.latitude || ""));
                const long = parseFloat(String(loc.long || loc.lng || loc.longitude || ""));
                const radius = loc.radius !== undefined ? parseFloat(String(loc.radius)) : undefined;
                if (!isNaN(lat) && !isNaN(long)) {
                    filters.location = Object.assign({ lat,
                        long }, (radius !== undefined && !isNaN(radius) ? { radius } : {}));
                }
            }
        }
        catch (error) {
            // Invalid JSON or parsing error, skip location filter
            console.error("Error parsing location filter:", error);
        }
    }
    else if (query.lat !== undefined && (query.long !== undefined || query.lng !== undefined)) {
        // Support flat lat/long or lat/lng parameters for backward compatibility
        const lat = parseFloat(String(query.lat));
        const long = parseFloat(String(query.long || query.lng || ""));
        if (!isNaN(lat) && !isNaN(long)) {
            filters.location = { lat, long };
        }
    }
    // Merge filters: individual query params always take precedence over data field params
    // This ensures that ?page=6 always overrides any page value in the data field
    const merged = Object.assign(Object.assign({}, dataFilters), filters);
    // Explicitly ensure pagination from individual query params always takes precedence
    // This is a safety measure to ensure page/perPage from query string always wins
    // Also ensure they are always integers
    if (filters.page !== undefined) {
        merged.page = typeof filters.page === "number" ? Math.floor(filters.page) : parseInt(String(filters.page), 10);
        if (isNaN(merged.page) || merged.page < 1) {
            delete merged.page; // Remove invalid page value
        }
    }
    if (filters.perPage !== undefined) {
        merged.perPage = typeof filters.perPage === "number" ? Math.floor(filters.perPage) : parseInt(String(filters.perPage), 10);
        if (isNaN(merged.perPage) || merged.perPage < 1) {
            delete merged.perPage; // Remove invalid perPage value
        }
    }
    console.log("parseDealFilters - After merge:", {
        hasDataFilters,
        dataFiltersPage: dataFilters.page,
        dataFiltersPerPage: dataFilters.perPage,
        filtersPage: filters.page,
        filtersPerPage: filters.perPage,
        mergedPage: merged.page,
        mergedPerPage: merged.perPage,
    });
    // Check if there are any meaningful filters (excluding pagination)
    // Define all filter fields from DealFilters (excluding page and perPage)
    const ALL_FILTER_FIELDS = [
        "deal_id",
        "dealership_car_id",
        "dealership_id",
        "internal_label",
        "status",
        "sale_status",
        "insurance",
        "hitme",
        "delivery_method",
        "monthly_price",
        "deposit",
        "mileage",
        "lease_frequency",
        "lease_period",
        "inclusion",
        "created_at_from",
        "created_at_to",
        "make",
        "model",
        "transmission",
        "fuel",
        "body",
        "color",
        "seat",
        "tax_class",
        "wheel_drive",
        "spec",
        "min_mileage_car",
        "max_mileage_car",
        "batterycap",
        "city",
        "region",
        "location",
        "sort",
    ];
    // Helper function to check if a filter value is meaningful (non-empty)
    const hasMeaningfulValue = (value) => {
        if (value === undefined || value === null)
            return false;
        // Check if array is non-empty
        if (Array.isArray(value))
            return value.length > 0;
        // Check if string is non-empty
        if (typeof value === "string")
            return value.length > 0;
        // Check if object has properties (e.g., location filter)
        if (typeof value === "object")
            return Object.keys(value).length > 0;
        // For booleans, numbers, etc., if they exist, they're meaningful
        return true;
    };
    // Check if any filter field has a meaningful value
    const hasNoFilter = !ALL_FILTER_FIELDS.some((field) => hasMeaningfulValue(merged[field]));
    // Return merged filters with hasNoFilter flag
    return Object.assign(Object.assign({}, merged), { hasNoFilter });
};
exports.parseDealFilters = parseDealFilters;
/**
 * Parses filters from an object (e.g., from 'data' field).
 * Handles the same fields as parseDealFilters but from an object structure.
 *
 * @param {Record<string, unknown>} dataObj Object containing filter fields.
 * @return {DealFilters} Parsed filters object.
 */
const parseFiltersFromObject = (dataObj) => {
    const filters = {};
    // Simple string fields
    if (dataObj.deal_id !== undefined) {
        filters.deal_id = String(dataObj.deal_id);
    }
    if (dataObj.dealership_car_id !== undefined) {
        filters.dealership_car_id = String(dataObj.dealership_car_id);
    }
    if (dataObj.dealership_id !== undefined) {
        filters.dealership_id = String(dataObj.dealership_id);
    }
    if (dataObj.internal_label !== undefined) {
        filters.internal_label = String(dataObj.internal_label);
    }
    if (dataObj.status !== undefined) {
        filters.status = String(dataObj.status);
    }
    if (dataObj.sale_status !== undefined) {
        filters.sale_status = String(dataObj.sale_status);
    }
    if (dataObj.delivery_method !== undefined) {
        filters.delivery_method = String(dataObj.delivery_method);
    }
    if (dataObj.lease_frequency !== undefined) {
        filters.lease_frequency = String(dataObj.lease_frequency);
    }
    // Boolean fields
    if (dataObj.insurance !== undefined) {
        if (typeof dataObj.insurance === "boolean") {
            filters.insurance = dataObj.insurance;
        }
        else {
            const insuranceValue = String(dataObj.insurance);
            filters.insurance = insuranceValue === "true" || insuranceValue === "1";
        }
    }
    if (dataObj.hitme !== undefined) {
        if (typeof dataObj.hitme === "boolean") {
            filters.hitme = dataObj.hitme;
        }
        else {
            const hitmeValue = String(dataObj.hitme);
            filters.hitme = hitmeValue === "true" || hitmeValue === "1";
        }
    }
    // Number arrays (range filters)
    if (dataObj.monthly_price !== undefined) {
        filters.monthly_price = parseNumberArrayFromValue(dataObj.monthly_price);
    }
    if (dataObj.deposit !== undefined) {
        filters.deposit = parseNumberArrayFromValue(dataObj.deposit);
    }
    if (dataObj.mileage !== undefined) {
        filters.mileage = parseNumberArrayFromValue(dataObj.mileage);
    }
    if (dataObj.lease_period !== undefined) {
        filters.lease_period = parseNumberArrayFromValue(dataObj.lease_period);
    }
    if (dataObj.batterycap !== undefined) {
        filters.batterycap = parseBatterycapArrayFromValue(dataObj.batterycap);
    }
    // Number arrays (filter arrays)
    if (dataObj.make !== undefined) {
        filters.make = parseNumberArrayFromValue(dataObj.make);
    }
    if (dataObj.model !== undefined) {
        filters.model = parseNumberArrayFromValue(dataObj.model);
    }
    if (dataObj.seat !== undefined) {
        filters.seat = parseNumberArrayFromValue(dataObj.seat);
    }
    if (dataObj.inclusion !== undefined) {
        filters.inclusion = parseNumberArrayFromValue(dataObj.inclusion);
    }
    if (dataObj.spec !== undefined) {
        filters.spec = parseNumberArrayFromValue(dataObj.spec);
    }
    // String arrays
    if (dataObj.transmission !== undefined) {
        filters.transmission = parseStringArrayFromValue(dataObj.transmission);
    }
    if (dataObj.fuel !== undefined) {
        filters.fuel = parseStringArrayFromValue(dataObj.fuel);
    }
    if (dataObj.color !== undefined) {
        filters.color = parseStringArrayFromValue(dataObj.color);
    }
    if (dataObj.body !== undefined) {
        filters.body = parseStringArrayFromValue(dataObj.body);
    }
    if (dataObj.city !== undefined) {
        filters.city = parseNumberArrayFromValue(dataObj.city);
    }
    if (dataObj.region !== undefined) {
        filters.region = parseNumberArrayFromValue(dataObj.region);
    }
    if (dataObj.tax_class !== undefined) {
        filters.tax_class = parseStringArrayFromValue(dataObj.tax_class);
    }
    if (dataObj.wheel_drive !== undefined) {
        filters.wheel_drive = parseStringArrayFromValue(dataObj.wheel_drive);
    }
    // Date fields
    if (dataObj.created_at_from !== undefined) {
        filters.created_at_from = String(dataObj.created_at_from);
    }
    if (dataObj.created_at_to !== undefined) {
        filters.created_at_to = String(dataObj.created_at_to);
    }
    // Car mileage range
    if (dataObj.min_mileage_car !== undefined) {
        const val = typeof dataObj.min_mileage_car === "number" ?
            dataObj.min_mileage_car :
            parseFloat(String(dataObj.min_mileage_car));
        if (!isNaN(val)) {
            filters.min_mileage_car = val;
        }
    }
    if (dataObj.max_mileage_car !== undefined) {
        const val = typeof dataObj.max_mileage_car === "number" ?
            dataObj.max_mileage_car :
            parseFloat(String(dataObj.max_mileage_car));
        if (!isNaN(val)) {
            filters.max_mileage_car = val;
        }
    }
    // Pagination
    if (dataObj.page !== undefined && dataObj.page !== null) {
        // Handle case where page might be an array
        const pageValue = Array.isArray(dataObj.page) ? dataObj.page[0] : dataObj.page;
        const val = typeof pageValue === "number" ?
            pageValue :
            parseInt(String(pageValue), 10);
        console.log("parseFiltersFromObject - Page parsing:", {
            original: dataObj.page,
            pageValue,
            type: typeof pageValue,
            parsed: val,
            isValid: !isNaN(val) && val > 0,
        });
        if (!isNaN(val) && val > 0) {
            filters.page = Math.floor(val); // Ensure it's an integer
        }
    }
    if (dataObj.perPage !== undefined && dataObj.perPage !== null) {
        // Handle case where perPage might be an array
        const perPageValue = Array.isArray(dataObj.perPage) ? dataObj.perPage[0] : dataObj.perPage;
        const val = typeof perPageValue === "number" ?
            perPageValue :
            parseInt(String(perPageValue), 10);
        if (!isNaN(val) && val > 0) {
            filters.perPage = Math.floor(val); // Ensure it's an integer
        }
    }
    // Sort parameter
    if (dataObj.sort !== undefined && dataObj.sort !== null) {
        const sortValue = String(dataObj.sort);
        // Validate sort value
        const validSortValues = [
            "monthly_price_asc", "monthly_price_desc",
            "deposit_asc", "deposit_desc",
            "mileage_asc", "mileage_desc",
            "registration_year_asc", "registration_year_desc",
            "published_asc", "published_desc",
        ];
        if (validSortValues.includes(sortValue) || sortValue === "null" || sortValue === "") {
            filters.sort = sortValue === "null" || sortValue === "" ? null : sortValue;
        }
    }
    // Session ID parameter for consistent random ordering
    // Location object
    if (dataObj.location !== undefined) {
        try {
            if (dataObj.location && typeof dataObj.location === "object" && !Array.isArray(dataObj.location)) {
                const loc = dataObj.location;
                // Support lat, latitude, lng, long, longitude
                const lat = typeof loc.lat === "number" ? loc.lat :
                    parseFloat(String(loc.lat || loc.latitude || ""));
                const long = typeof loc.long === "number" ? loc.long :
                    typeof loc.lng === "number" ? loc.lng :
                        typeof loc.longitude === "number" ? loc.longitude :
                            parseFloat(String(loc.long || loc.lng || loc.longitude || ""));
                const radius = loc.radius !== undefined ?
                    (typeof loc.radius === "number" ? loc.radius : parseFloat(String(loc.radius))) :
                    undefined;
                if (!isNaN(lat) && !isNaN(long)) {
                    filters.location = Object.assign({ lat,
                        long }, (radius !== undefined && !isNaN(radius) ? { radius } : {}));
                }
            }
        }
        catch (error) {
            // Invalid location object, skip location filter
            console.error("Error parsing location filter from data:", error);
        }
    }
    return filters;
};
/**
 * Parses a value into a number array.
 * Handles arrays, comma-separated strings, or single values.
 *
 * @param {unknown} value Value to parse.
 * @return {number[] | undefined} Parsed number array.
 */
const parseNumberArrayFromValue = (value) => {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((v) => parseFloat(String(v))).filter((v) => !isNaN(v));
    }
    if (typeof value === "string") {
        // Try parsing as JSON first
        if (value.startsWith("[")) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => parseFloat(String(v))).filter((v) => !isNaN(v));
                }
            }
            catch (_a) {
                // Not valid JSON, continue with comma-separated parsing
            }
        }
        // Parse as comma-separated string
        return value.split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
            .map((v) => parseFloat(v))
            .filter((v) => !isNaN(v));
    }
    // Single number value
    const num = typeof value === "number" ? value : parseFloat(String(value));
    if (!isNaN(num)) {
        return [num];
    }
    return undefined;
};
/**
 * Parses a value into a string array.
 * Handles arrays, comma-separated strings, or single values.
 *
 * @param {unknown} value Value to parse.
 * @return {string[] | undefined} Parsed string array.
 */
const parseStringArrayFromValue = (value) => {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((v) => String(v)).filter((v) => v.length > 0);
    }
    if (typeof value === "string") {
        // Try parsing as JSON first
        if (value.startsWith("[")) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => String(v)).filter((v) => v.length > 0);
                }
            }
            catch (_a) {
                // Not valid JSON, continue with comma-separated parsing
            }
        }
        // Parse as comma-separated string
        return value.split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
    }
    // Single string value
    const str = String(value);
    if (str.length > 0) {
        return [str];
    }
    return undefined;
};
/**
 * Parses a query parameter value into a batterycap array that can contain null values.
 * Supports JSON arrays with format: [value1, value2], [value1, null], [null, value2]
 *
 * @param {unknown} value Query parameter value.
 * @return {(number | null)[] | undefined} Parsed batterycap array with null support.
 */
const parseBatterycapArray = (value) => {
    if (!value) {
        return undefined;
    }
    try {
        // Convert to string first
        let strValue;
        if (Array.isArray(value)) {
            // If already an array, process it directly
            return value.map((v) => {
                if (v === null || v === undefined || v === "null" || v === "")
                    return null;
                const num = typeof v === "number" ? v : parseFloat(String(v));
                return isNaN(num) ? null : num;
            });
        }
        else if (typeof value === "string") {
            strValue = value;
        }
        else {
            strValue = String(value);
        }
        // Try parsing as JSON first
        if (strValue.startsWith("[")) {
            try {
                const parsed = JSON.parse(strValue);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => {
                        if (v === null || v === undefined || v === "null" || v === "")
                            return null;
                        const num = typeof v === "number" ? v : parseFloat(String(v));
                        return isNaN(num) ? null : num;
                    });
                }
            }
            catch (_a) {
                // Not valid JSON, return undefined
                return undefined;
            }
        }
        // If not JSON array, return undefined (batterycap must be JSON array format)
        return undefined;
    }
    catch (_b) {
        return undefined;
    }
};
/**
 * Parses a value into a batterycap array that can contain null values.
 * Handles arrays with format: [value1, value2], [value1, null], [null, value2]
 *
 * @param {unknown} value Value to parse.
 * @return {(number | null)[] | undefined} Parsed batterycap array with null support.
 */
const parseBatterycapArrayFromValue = (value) => {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((v) => {
            if (v === null || v === undefined || v === "null" || v === "")
                return null;
            const num = typeof v === "number" ? v : parseFloat(String(v));
            return isNaN(num) ? null : num;
        });
    }
    if (typeof value === "string") {
        // Try parsing as JSON first
        if (value.startsWith("[")) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => {
                        if (v === null || v === undefined || v === "null" || v === "")
                            return null;
                        const num = typeof v === "number" ? v : parseFloat(String(v));
                        return isNaN(num) ? null : num;
                    });
                }
            }
            catch (_a) {
                // Not valid JSON
                return undefined;
            }
        }
        // If not JSON array, return undefined
        return undefined;
    }
    return undefined;
};
/**
 * Parses a query parameter value into a number array.
 * Supports comma-separated strings or JSON arrays.
 *
 * @param {unknown} value Query parameter value.
 * @return {number[] | undefined} Parsed number array.
 */
const parseNumberArray = (value) => {
    if (!value) {
        return undefined;
    }
    try {
        // Convert to string first
        let strValue;
        if (Array.isArray(value)) {
            strValue = value.map((v) => String(v)).join(",");
        }
        else if (typeof value === "string") {
            strValue = value;
        }
        else {
            strValue = String(value);
        }
        // Try parsing as JSON first
        if (strValue.startsWith("[")) {
            try {
                const parsed = JSON.parse(strValue);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => parseFloat(String(v))).filter((v) => !isNaN(v));
                }
            }
            catch (_a) {
                // Not valid JSON, continue with comma-separated parsing
            }
        }
        // Parse as comma-separated string
        return strValue.split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
            .map((v) => parseFloat(v))
            .filter((v) => !isNaN(v));
    }
    catch (_b) {
        return undefined;
    }
};
/**
 * Parses a query parameter value into a string array.
 * Supports comma-separated strings or JSON arrays.
 *
 * @param {unknown} value Query parameter value.
 * @return {string[] | undefined} Parsed string array.
 */
const parseStringArray = (value) => {
    if (!value) {
        return undefined;
    }
    try {
        // Convert to string first
        let strValue;
        if (Array.isArray(value)) {
            strValue = value.map((v) => String(v)).join(",");
        }
        else if (typeof value === "string") {
            strValue = value;
        }
        else {
            strValue = String(value);
        }
        // Try parsing as JSON first
        if (strValue.startsWith("[")) {
            try {
                const parsed = JSON.parse(strValue);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => String(v)).filter((v) => v.length > 0);
                }
            }
            catch (_a) {
                // Not valid JSON, continue with comma-separated parsing
            }
        }
        // Parse as comma-separated string
        return strValue.split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
    }
    catch (_b) {
        return undefined;
    }
};
//# sourceMappingURL=queryParser.js.map