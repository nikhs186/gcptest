"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeals = void 0;
const pg_1 = require("./pg");
const clickhouse_1 = require("./clickhouse");
const auth_1 = require("./auth");
/** [min, 0] with min > 0 means minimum-only (e.g. deposit >= 1000), not a closed range. */
const shouldApplyRangeMax = (min, max) => {
    return !(max === 0 && min > 0);
};
/** Deposit-only: [0, 0] means exactly zero deposit. */
const isDepositExactZero = (values) => {
    return values.length >= 2 && Number(values[0]) === 0 && Number(values[1]) === 0;
};
/**
 * Builds WHERE clause and parameters from filters (excluding pagination).
 *
 * @param {DealFilters} filters Filters to apply.
 * @return {Object} Object with whereClause string and params array.
 */
const buildWhereClause = (filters, favoritedDealIds = null) => {
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    // Always filter by status = "active" at the top (cannot be overridden)
    conditions.push(`d.xdo->>'status' = $${paramIndex}`);
    params.push("active");
    paramIndex++;
    // Filter by favorited deal IDs if provided
    if (favoritedDealIds !== null && favoritedDealIds.length > 0) {
        conditions.push(`d.id = ANY($${paramIndex}::uuid[])`);
        params.push(favoritedDealIds);
        paramIndex++;
    }
    else if (favoritedDealIds !== null && favoritedDealIds.length === 0) {
        // If favoritedDealIds is an empty array, return no results
        conditions.push("1 = 0");
    }
    if (filters.deal_id !== undefined) {
        conditions.push(`d.id = $${paramIndex}`);
        params.push(filters.deal_id);
        paramIndex++;
    }
    if (filters.dealership_car_id !== undefined) {
        conditions.push(`(d.xdo->>'dealership_car_id')::uuid = $${paramIndex}::uuid`);
        params.push(filters.dealership_car_id);
        paramIndex++;
    }
    if (filters.dealership_id !== undefined) {
        conditions.push(`(d.xdo->>'dealership_id')::uuid = $${paramIndex}::uuid`);
        params.push(filters.dealership_id);
        paramIndex++;
    }
    if (filters.internal_label) {
        conditions.push(`LOWER(d.xdo->>'internal_label') LIKE LOWER($${paramIndex})`);
        params.push(`%${filters.internal_label}%`);
        paramIndex++;
    }
    if (filters.sale_status) {
        conditions.push(`d.xdo->>'sale_status' = $${paramIndex}`);
        params.push(filters.sale_status);
        paramIndex++;
    }
    if (filters.insurance !== undefined) {
        conditions.push(`(d.xdo->>'insurance')::boolean = $${paramIndex}`);
        params.push(filters.insurance);
        paramIndex++;
    }
    if (filters.hitme !== undefined) {
        conditions.push(`(d.xdo->>'hitme')::boolean = $${paramIndex}`);
        params.push(filters.hitme);
        paramIndex++;
    }
    if (filters.delivery_method) {
        conditions.push(`d.xdo->>'delivery_method' = $${paramIndex}`);
        params.push(filters.delivery_method);
        paramIndex++;
    }
    if (filters.monthly_price && Array.isArray(filters.monthly_price) && filters.monthly_price.length > 0) {
        const monthlyMin = Number(filters.monthly_price[0]);
        if (filters.monthly_price.length >= 2 && shouldApplyRangeMax(monthlyMin, Number(filters.monthly_price[1]))) {
            // [min, max] range
            // Use BIGINT to handle large values that exceed INTEGER range
            conditions.push(`(d.xdo->>'monthly_price')::bigint >= $${paramIndex} AND (d.xdo->>'monthly_price')::bigint <= $${paramIndex + 1}`);
            params.push(filters.monthly_price[0]);
            params.push(filters.monthly_price[1]);
            paramIndex += 2;
        }
        else {
            // Single value or [min, 0] with min > 0 — minimum only
            conditions.push(`(d.xdo->>'monthly_price')::bigint >= $${paramIndex}`);
            params.push(filters.monthly_price[0]);
            paramIndex++;
        }
    }
    if (filters.deposit && Array.isArray(filters.deposit) && filters.deposit.length > 0) {
        if (isDepositExactZero(filters.deposit)) {
            conditions.push(`(d.xdo->>'deposit')::bigint = $${paramIndex}`);
            params.push(0);
            paramIndex++;
        }
        else {
            const depositMin = Number(filters.deposit[0]);
            if (filters.deposit.length >= 2 && shouldApplyRangeMax(depositMin, Number(filters.deposit[1]))) {
                // [min, max] range
                // Use BIGINT to handle large values that exceed INTEGER range
                conditions.push(`(d.xdo->>'deposit')::bigint >= $${paramIndex} AND (d.xdo->>'deposit')::bigint <= $${paramIndex + 1}`);
                params.push(filters.deposit[0]);
                params.push(filters.deposit[1]);
                paramIndex += 2;
            }
            else {
                // Single value or [min, 0] with min > 0 — minimum only
                conditions.push(`(d.xdo->>'deposit')::bigint >= $${paramIndex}`);
                params.push(filters.deposit[0]);
                paramIndex++;
            }
        }
    }
    if (filters.mileage && Array.isArray(filters.mileage) && filters.mileage.length > 0) {
        const dealMileageExpr = "(COALESCE(NULLIF(d.xdo->>'yearly_mileage', ''), d.xdo->>'mileage'))::bigint";
        const mileageMin = Number(filters.mileage[0]);
        if (filters.mileage.length >= 2 && shouldApplyRangeMax(mileageMin, Number(filters.mileage[1]))) {
            // [min, max] range
            // Use BIGINT to handle large values that exceed INTEGER range
            conditions.push(`${dealMileageExpr} >= $${paramIndex} AND ${dealMileageExpr} <= $${paramIndex + 1}`);
            params.push(filters.mileage[0]);
            params.push(filters.mileage[1]);
            paramIndex += 2;
        }
        else {
            // Single value or [min, 0] with min > 0 — minimum only
            conditions.push(`${dealMileageExpr} >= $${paramIndex}`);
            params.push(filters.mileage[0]);
            paramIndex++;
        }
    }
    if (filters.lease_frequency) {
        conditions.push(`d.xdo->>'lease_frequency' = $${paramIndex}`);
        params.push(filters.lease_frequency);
        paramIndex++;
    }
    if (filters.lease_period && Array.isArray(filters.lease_period) && filters.lease_period.length > 0) {
        const leaseMin = Number(filters.lease_period[0]);
        if (filters.lease_period.length >= 2 && shouldApplyRangeMax(leaseMin, Number(filters.lease_period[1]))) {
            // [min, max] range
            // Use BIGINT to handle large values that exceed INTEGER range
            conditions.push(`(d.xdo->>'lease_period')::bigint >= $${paramIndex} AND (d.xdo->>'lease_period')::bigint <= $${paramIndex + 1}`);
            params.push(filters.lease_period[0]);
            params.push(filters.lease_period[1]);
            paramIndex += 2;
        }
        else {
            // Single value or [min, 0] with min > 0 — minimum only
            conditions.push(`(d.xdo->>'lease_period')::bigint >= $${paramIndex}`);
            params.push(filters.lease_period[0]);
            paramIndex++;
        }
    }
    if (filters.inclusion && Array.isArray(filters.inclusion) && filters.inclusion.length > 0) {
        // Use EXISTS to check if any values in inclusion array match the filter
        // Only check when inclusion field exists and is an array type
        conditions.push(`d.xdo->'inclusion' IS NOT NULL 
            AND jsonb_typeof(d.xdo->'inclusion') = 'array' 
            AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements_text(d.xdo->'inclusion') AS elem
                WHERE elem::integer = ANY($${paramIndex}::integer[])
            )`);
        params.push(filters.inclusion);
        paramIndex++;
    }
    if (filters.created_at_from) {
        // Convert Unix timestamp (milliseconds) to PostgreSQL timestamp
        // Filter accepts date strings or Unix timestamps (converted to timestamp)
        const fromDate = typeof filters.created_at_from === "string" && /^\d+$/.test(filters.created_at_from) ?
            new Date(Number(filters.created_at_from)).toISOString() :
            filters.created_at_from;
        conditions.push(`to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) >= $${paramIndex}::timestamp`);
        params.push(fromDate);
        paramIndex++;
    }
    if (filters.created_at_to) {
        // Convert Unix timestamp (milliseconds) to PostgreSQL timestamp
        // Filter accepts date strings or Unix timestamps (converted to timestamp)
        const toDate = typeof filters.created_at_to === "string" && /^\d+$/.test(filters.created_at_to) ?
            new Date(Number(filters.created_at_to)).toISOString() :
            filters.created_at_to;
        conditions.push(`to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) <= $${paramIndex}::timestamp`);
        params.push(toDate);
        paramIndex++;
    }
    if (filters.make && Array.isArray(filters.make) && filters.make.length > 0) {
        // Filter by make IDs
        conditions.push(`(dc.xdo->'make'->>'id')::integer = ANY($${paramIndex}::integer[])`);
        params.push(filters.make);
        paramIndex++;
    }
    if (filters.model && Array.isArray(filters.model) && filters.model.length > 0) {
        // Filter by model IDs
        conditions.push(`(dc.xdo->'model'->>'id')::integer = ANY($${paramIndex}::integer[])`);
        params.push(filters.model);
        paramIndex++;
    }
    if (filters.transmission && Array.isArray(filters.transmission) && filters.transmission.length > 0) {
        conditions.push(`dc.xdo->>'transmission' = ANY($${paramIndex}::text[])`);
        params.push(filters.transmission);
        paramIndex++;
    }
    if (filters.fuel && Array.isArray(filters.fuel) && filters.fuel.length > 0) {
        conditions.push(`dc.xdo->>'fuel' = ANY($${paramIndex}::text[])`);
        params.push(filters.fuel);
        paramIndex++;
    }
    if (filters.body && Array.isArray(filters.body) && filters.body.length > 0) {
        conditions.push(`dc.xdo->>'body' = ANY($${paramIndex}::text[])`);
        params.push(filters.body);
        paramIndex++;
    }
    if (filters.color && Array.isArray(filters.color) && filters.color.length > 0) {
        conditions.push(`dc.xdo->>'color' = ANY($${paramIndex}::text[])`);
        params.push(filters.color);
        paramIndex++;
    }
    if (filters.seat && Array.isArray(filters.seat) && filters.seat.length > 0) {
        conditions.push(`(dc.xdo->>'seat')::integer = ANY($${paramIndex}::integer[])`);
        params.push(filters.seat);
        paramIndex++;
    }
    if (filters.seat_range && Array.isArray(filters.seat_range) && filters.seat_range.length > 0) {
        if (filters.seat_range.length >= 2) {
            conditions.push(`(dc.xdo->>'seat')::integer >= $${paramIndex} AND (dc.xdo->>'seat')::integer <= $${paramIndex + 1}`);
            params.push(filters.seat_range[0]);
            params.push(filters.seat_range[1]);
            paramIndex += 2;
        }
        else if (filters.seat_range.length === 1) {
            conditions.push(`(dc.xdo->>'seat')::integer >= $${paramIndex}`);
            params.push(filters.seat_range[0]);
            paramIndex++;
        }
    }
    if (filters.tax_class && Array.isArray(filters.tax_class) && filters.tax_class.length > 0) {
        conditions.push(`dc.xdo->>'tax_class' = ANY($${paramIndex}::text[])`);
        params.push(filters.tax_class);
        paramIndex++;
    }
    if (filters.wheel_drive && Array.isArray(filters.wheel_drive) && filters.wheel_drive.length > 0) {
        conditions.push(`dc.xdo->>'wheel_drive' = ANY($${paramIndex}::text[])`);
        params.push(filters.wheel_drive);
        paramIndex++;
    }
    if (filters.spec && Array.isArray(filters.spec) && filters.spec.length > 0) {
        // Use EXISTS to check if any values in spec array match the filter
        // Only check when spec field exists and is an array type
        conditions.push(`dc.xdo->'spec' IS NOT NULL 
            AND jsonb_typeof(dc.xdo->'spec') = 'array' 
            AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements_text(dc.xdo->'spec') AS elem
                WHERE elem::integer = ANY($${paramIndex}::integer[])
            )`);
        params.push(filters.spec);
        paramIndex++;
    }
    if (filters.min_mileage_car !== undefined) {
        // Use BIGINT to handle large values that exceed INTEGER range
        conditions.push(`(dc.xdo->>'mileage')::bigint >= $${paramIndex}`);
        params.push(filters.min_mileage_car);
        paramIndex++;
    }
    if (filters.max_mileage_car !== undefined) {
        // Use BIGINT to handle large values that exceed INTEGER range
        conditions.push(`(dc.xdo->>'mileage')::bigint <= $${paramIndex}`);
        params.push(filters.max_mileage_car);
        paramIndex++;
    }
    // Batterycap filter - supports [value1, value2], [value1, null], [null, value2]
    if (filters.batterycap && Array.isArray(filters.batterycap) && filters.batterycap.length > 0) {
        const batterycapArray = filters.batterycap.filter((v) => v !== null && v !== undefined);
        if (batterycapArray.length > 0) {
            if (filters.batterycap.length >= 2) {
                const minValue = filters.batterycap[0];
                const maxValue = filters.batterycap[1];
                if (minValue !== null && minValue !== undefined && maxValue !== null && maxValue !== undefined) {
                    // [value1, value2] - both values present
                    conditions.push(`(dc.xdo->>'batterycap')::bigint >= $${paramIndex} AND (dc.xdo->>'batterycap')::bigint <= $${paramIndex + 1}`);
                    params.push(minValue);
                    params.push(maxValue);
                    paramIndex += 2;
                }
                else if (minValue !== null && minValue !== undefined) {
                    // [value1, null] - only minimum
                    conditions.push(`(dc.xdo->>'batterycap')::bigint >= $${paramIndex}`);
                    params.push(minValue);
                    paramIndex++;
                }
                else if (maxValue !== null && maxValue !== undefined) {
                    // [null, value2] - only maximum
                    conditions.push(`(dc.xdo->>'batterycap')::bigint <= $${paramIndex}`);
                    params.push(maxValue);
                    paramIndex++;
                }
            }
            else if (filters.batterycap.length === 1 && filters.batterycap[0] !== null && filters.batterycap[0] !== undefined) {
                // [value1] - single value treated as minimum
                conditions.push(`(dc.xdo->>'batterycap')::bigint >= $${paramIndex}`);
                params.push(filters.batterycap[0]);
                paramIndex++;
            }
        }
    }
    // City filter - filter by municipality ID
    // Requires joining with dealership table (mvpw1_6) and municipality table (mvpw1_62)
    if (filters.city && Array.isArray(filters.city) && filters.city.length > 0) {
        conditions.push(`EXISTS (
            SELECT 1
            FROM public.mvpw1_6 dl_city
            WHERE dl_city.id = (d.xdo->>'dealership_id')::uuid
            AND (
                CASE
                    WHEN jsonb_typeof(dl_city.xdo->'location'->'muncipality') = 'number' THEN
                        (dl_city.xdo->'location'->'muncipality')::integer
                    WHEN jsonb_typeof(dl_city.xdo->'location'->'muncipality') = 'string'
                         AND dl_city.xdo->'location'->>'muncipality' IS NOT NULL
                         AND dl_city.xdo->'location'->>'muncipality' != ''
                         AND (dl_city.xdo->'location'->>'muncipality') ~ '^[0-9]+$' THEN
                        (dl_city.xdo->'location'->>'muncipality')::integer
                    ELSE NULL
                END
            ) = ANY($${paramIndex}::integer[])
        )`);
        params.push(filters.city);
        paramIndex++;
    }
    // Region filter - filter by country ID (region is stored as country in location object)
    // Requires joining with dealership table (mvpw1_6)
    if (filters.region && Array.isArray(filters.region) && filters.region.length > 0) {
        conditions.push(`EXISTS (
            SELECT 1
            FROM public.mvpw1_6 dl_region
            WHERE dl_region.id = (d.xdo->>'dealership_id')::uuid
            AND (
                CASE
                    WHEN jsonb_typeof(dl_region.xdo->'location'->'country') = 'number' THEN
                        (dl_region.xdo->'location'->'country')::integer
                    WHEN jsonb_typeof(dl_region.xdo->'location'->'country') = 'string'
                         AND dl_region.xdo->'location'->>'country' IS NOT NULL
                         AND dl_region.xdo->'location'->>'country' != ''
                         AND (dl_region.xdo->'location'->>'country') ~ '^[0-9]+$' THEN
                        (dl_region.xdo->'location'->>'country')::integer
                    ELSE NULL
                END
            ) = ANY($${paramIndex}::integer[])
        )`);
        params.push(filters.region);
        paramIndex++;
    }
    const whereClause = conditions.length > 0 ?
        `WHERE ${conditions.join(" AND ")}` :
        "";
    return { whereClause, params };
};
/**
 * Builds ClickHouse WHERE clause and named params from filters.
 * Completely independent from the PostgreSQL buildWhereClause above.
 */
const buildClickHouseWhereClause = (filters, favoritedDealIds = null) => {
    const conditions = [];
    const params = {};
    conditions.push("JSONExtractString(d.xdo, 'status') = {status:String}");
    params.status = "active";
    if (favoritedDealIds !== null && favoritedDealIds.length > 0) {
        conditions.push("d.id IN {dealIds:Array(UUID)}");
        params.dealIds = favoritedDealIds;
    }
    else if (favoritedDealIds !== null && favoritedDealIds.length === 0) {
        conditions.push("1 = 0");
    }
    if (filters.deal_id) {
        conditions.push("d.id = {dealId:UUID}");
        params.dealId = filters.deal_id;
    }
    if (filters.sale_status) {
        conditions.push("JSONExtractString(d.xdo, 'sale_status') = {saleStatus:String}");
        params.saleStatus = filters.sale_status;
    }
    // --- Deal-level range fields (d.xdo) ---
    if (filters.monthly_price && Array.isArray(filters.monthly_price) && filters.monthly_price.length > 0) {
        const monthlyMin = Number(filters.monthly_price[0]);
        conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'monthly_price')) >= {monthlyPriceMin:Int64}");
        params.monthlyPriceMin = monthlyMin;
        if (filters.monthly_price.length >= 2 && shouldApplyRangeMax(monthlyMin, Number(filters.monthly_price[1]))) {
            conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'monthly_price')) <= {monthlyPriceMax:Int64}");
            params.monthlyPriceMax = Number(filters.monthly_price[1]);
        }
    }
    if (filters.deposit && Array.isArray(filters.deposit) && filters.deposit.length > 0) {
        if (isDepositExactZero(filters.deposit)) {
            conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'deposit')) = {depositExact:Int64}");
            params.depositExact = 0;
        }
        else {
            const depositMin = Number(filters.deposit[0]);
            conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'deposit')) >= {depositMin:Int64}");
            params.depositMin = depositMin;
            if (filters.deposit.length >= 2 && shouldApplyRangeMax(depositMin, Number(filters.deposit[1]))) {
                conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'deposit')) <= {depositMax:Int64}");
                params.depositMax = Number(filters.deposit[1]);
            }
        }
    }
    if (filters.lease_period && Array.isArray(filters.lease_period) && filters.lease_period.length > 0) {
        const leaseMin = Number(filters.lease_period[0]);
        conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'lease_period')) >= {leasePeriodMin:Int64}");
        params.leasePeriodMin = leaseMin;
        if (filters.lease_period.length >= 2 && shouldApplyRangeMax(leaseMin, Number(filters.lease_period[1]))) {
            conditions.push("toInt64OrZero(JSONExtractString(d.xdo, 'lease_period')) <= {leasePeriodMax:Int64}");
            params.leasePeriodMax = Number(filters.lease_period[1]);
        }
    }
    const mileageExpr = "toInt64OrZero(if(length(JSONExtractString(d.xdo, 'yearly_mileage')) > 0, JSONExtractString(d.xdo, 'yearly_mileage'), JSONExtractString(d.xdo, 'mileage')))";
    if (filters.mileage && Array.isArray(filters.mileage) && filters.mileage.length > 0) {
        const mileageMin = Number(filters.mileage[0]);
        conditions.push(`${mileageExpr} >= {mileageMin:Int64}`);
        params.mileageMin = mileageMin;
        if (filters.mileage.length >= 2 && shouldApplyRangeMax(mileageMin, Number(filters.mileage[1]))) {
            conditions.push(`${mileageExpr} <= {mileageMax:Int64}`);
            params.mileageMax = Number(filters.mileage[1]);
        }
    }
    if (filters.inclusion && Array.isArray(filters.inclusion) && filters.inclusion.length > 0) {
        conditions.push("hasAny(JSONExtract(d.xdo, 'inclusion', 'Array(Int64)'), {inclusionIds:Array(Int64)})");
        params.inclusionIds = filters.inclusion.map((i) => Number(i));
    }
    // --- Car-level fields (dc.xdo) ---
    if (filters.make && Array.isArray(filters.make) && filters.make.length > 0) {
        conditions.push("JSONExtractInt(dc.xdo, 'make', 'id') IN {makeIds:Array(Int64)}");
        params.makeIds = filters.make.map((id) => Number(id));
    }
    if (filters.model && Array.isArray(filters.model) && filters.model.length > 0) {
        conditions.push("JSONExtractInt(dc.xdo, 'model', 'id') IN {modelIds:Array(Int64)}");
        params.modelIds = filters.model.map((id) => Number(id));
    }
    if (filters.fuel && Array.isArray(filters.fuel) && filters.fuel.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'fuel') IN {fuelVals:Array(String)}");
        params.fuelVals = filters.fuel;
    }
    if (filters.transmission && Array.isArray(filters.transmission) && filters.transmission.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'transmission') IN {transmissionVals:Array(String)}");
        params.transmissionVals = filters.transmission;
    }
    if (filters.body && Array.isArray(filters.body) && filters.body.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'body') IN {bodyVals:Array(String)}");
        params.bodyVals = filters.body;
    }
    if (filters.tax_class && Array.isArray(filters.tax_class) && filters.tax_class.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'tax_class') IN {taxClassVals:Array(String)}");
        params.taxClassVals = filters.tax_class;
    }
    if (filters.wheel_drive && Array.isArray(filters.wheel_drive) && filters.wheel_drive.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'wheel_drive') IN {wheelDriveVals:Array(String)}");
        params.wheelDriveVals = filters.wheel_drive;
    }
    if (filters.color && Array.isArray(filters.color) && filters.color.length > 0) {
        conditions.push("JSONExtractString(dc.xdo, 'color') IN {colorVals:Array(String)}");
        params.colorVals = filters.color;
    }
    if (filters.seat && Array.isArray(filters.seat) && filters.seat.length > 0) {
        conditions.push("JSONExtractInt(dc.xdo, 'seat') IN {seatVals:Array(Int64)}");
        params.seatVals = filters.seat.map((s) => Number(s));
    }
    if (filters.seat_range && Array.isArray(filters.seat_range) && filters.seat_range.length > 0) {
        conditions.push("JSONExtractInt(dc.xdo, 'seat') >= {seatMin:Int64}");
        params.seatMin = Number(filters.seat_range[0]);
        if (filters.seat_range.length >= 2) {
            conditions.push("JSONExtractInt(dc.xdo, 'seat') <= {seatMax:Int64}");
            params.seatMax = Number(filters.seat_range[1]);
        }
    }
    if (filters.spec && Array.isArray(filters.spec) && filters.spec.length > 0) {
        conditions.push("hasAny(JSONExtract(dc.xdo, 'spec', 'Array(Int64)'), {specIds:Array(Int64)})");
        params.specIds = filters.spec.map((s) => Number(s));
    }
    if (filters.batterycap && Array.isArray(filters.batterycap) && filters.batterycap.length > 0) {
        const bcArr = filters.batterycap.filter((v) => v !== null && v !== undefined);
        if (bcArr.length > 0) {
            const minVal = filters.batterycap[0];
            const maxVal = filters.batterycap.length >= 2 ? filters.batterycap[1] : undefined;
            if (minVal !== null && minVal !== undefined) {
                conditions.push("toInt64OrZero(JSONExtractString(dc.xdo, 'batterycap')) >= {batterycapMin:Int64}");
                params.batterycapMin = Number(minVal);
            }
            if (maxVal !== null && maxVal !== undefined) {
                conditions.push("toInt64OrZero(JSONExtractString(dc.xdo, 'batterycap')) <= {batterycapMax:Int64}");
                params.batterycapMax = Number(maxVal);
            }
        }
    }
    const whereClause = conditions.length > 0 ?
        `WHERE ${conditions.join(" AND ")}` :
        "";
    return { whereClause, params };
};
/**
 * Builds the ClickHouse ORDER BY clause from the sort filter.
 * Mirrors the PostgreSQL sort options. created_at DESC is always appended as a
 * tiebreaker so rows with equal sort values have a stable, deterministic order
 * (prevents duplicates/skips across paginated pages). Unrecognized sort values
 * fall back to created_at DESC only.
 *
 * @param {string | null | undefined} sort Sort option from filters.
 * @return {string} ORDER BY clause string.
 */
const buildClickHouseOrderBy = (sort) => {
    const createdAtDesc = "toDateTime(toInt64OrZero(JSONExtractString(d.xdo, 'created_at')) / 1000) DESC";
    // Registration year: handle ms/seconds numeric timestamps and date strings.
    const regYear = `toYear(
      if(
        toInt64OrZero(JSONExtractString(dc.xdo, 'registration_date')) > 0,
        toDateTime(toInt64OrZero(JSONExtractString(dc.xdo, 'registration_date')) /
          if(toInt64OrZero(JSONExtractString(dc.xdo, 'registration_date')) > 1000000000000, 1000, 1)),
        parseDateTimeBestEffortOrNull(JSONExtractString(dc.xdo, 'registration_date'))
      )
    )`;
    let primarySort = null;
    switch (sort) {
        case "monthly_price_asc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'monthly_price')) ASC NULLS LAST";
            break;
        case "monthly_price_desc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'monthly_price')) DESC NULLS LAST";
            break;
        case "deposit_asc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'deposit')) ASC NULLS LAST";
            break;
        case "deposit_desc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'deposit')) DESC NULLS LAST";
            break;
        case "mileage_asc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'mileage')) ASC NULLS LAST";
            break;
        case "mileage_desc":
            primarySort = "toInt64OrZero(JSONExtractString(d.xdo, 'mileage')) DESC NULLS LAST";
            break;
        case "published_asc":
            primarySort = "toDateTime(toInt64OrZero(JSONExtractString(d.xdo, 'published_at')) / 1000) ASC NULLS LAST";
            break;
        case "published_desc":
            primarySort = "toDateTime(toInt64OrZero(JSONExtractString(d.xdo, 'published_at')) / 1000) DESC NULLS LAST";
            break;
        case "registration_year_asc":
            primarySort = `${regYear} ASC NULLS LAST`;
            break;
        case "registration_year_desc":
            primarySort = `${regYear} DESC NULLS LAST`;
            break;
    }
    return primarySort ?
        `ORDER BY ${primarySort}, ${createdAtDesc}` :
        `ORDER BY ${createdAtDesc}`;
};
/**
 * Builds the PlanetScale ORDER BY clause from the sort filter.
 * PlanetScale uses flat columns (no xdo/JSONB wrapper). Mirrors the PostgreSQL
 * sort options. created_at DESC is always appended as a tiebreaker so rows with
 * equal sort values have a stable, deterministic order. Unrecognized sort values
 * fall back to created_at DESC only.
 *
 * @param {string | null | undefined} sort Sort option from filters.
 * @return {string} ORDER BY clause string.
 */
const buildPlanetScaleOrderBy = (sort) => {
    const createdAtDesc = "d.created_at DESC";
    let primarySort = null;
    switch (sort) {
        case "monthly_price_asc":
            primarySort = "d.monthly_price ASC NULLS LAST";
            break;
        case "monthly_price_desc":
            primarySort = "d.monthly_price DESC NULLS LAST";
            break;
        case "deposit_asc":
            primarySort = "d.deposit ASC NULLS LAST";
            break;
        case "deposit_desc":
            primarySort = "d.deposit DESC NULLS LAST";
            break;
        case "mileage_asc":
            primarySort = "d.mileage ASC NULLS LAST";
            break;
        case "mileage_desc":
            primarySort = "d.mileage DESC NULLS LAST";
            break;
        case "published_asc":
            primarySort = "d.published_at ASC NULLS LAST";
            break;
        case "published_desc":
            primarySort = "d.published_at DESC NULLS LAST";
            break;
        case "registration_year_asc":
            primarySort = "EXTRACT(YEAR FROM dc.registration_date) ASC NULLS LAST";
            break;
        case "registration_year_desc":
            primarySort = "EXTRACT(YEAR FROM dc.registration_date) DESC NULLS LAST";
            break;
    }
    return primarySort ?
        `ORDER BY ${primarySort}, ${createdAtDesc}` :
        `ORDER BY ${createdAtDesc}`;
};
/**
 * Builds PlanetScale WHERE clause from filters.
 * PlanetScale tables use flat columns (no xdo/JSONB wrapper).
 * Car make/model/spec and deal inclusion are still JSONB columns.
 * Uses PostgreSQL parameterized syntax ($1, $2, …) via PlanetScale PG wire protocol.
 */
const buildPlanetScaleWhereClause = (filters, favoritedDealIds = null) => {
    const conditions = [];
    const params = [];
    let idx = 1;
    const p = (value) => {
        params.push(value);
        return `$${idx++}`;
    };
    const inList = (values) => {
        const ph = values.map(() => `$${idx++}`);
        params.push(...values);
        return `(${ph.join(", ")})`;
    };
    conditions.push(`d.status = ${p("active")}`);
    if (favoritedDealIds !== null && favoritedDealIds.length > 0) {
        conditions.push(`d.id IN ${inList(favoritedDealIds)}`);
    }
    else if (favoritedDealIds !== null && favoritedDealIds.length === 0) {
        conditions.push("1 = 0");
    }
    if (filters.deal_id) {
        conditions.push(`d.id = ${p(filters.deal_id)}`);
    }
    if (filters.sale_status) {
        conditions.push(`d.sale_status = ${p(filters.sale_status)}`);
    }
    // --- Deal-level range fields (flat bigint columns) ---
    if (filters.monthly_price && Array.isArray(filters.monthly_price) && filters.monthly_price.length > 0) {
        const monthlyMin = Number(filters.monthly_price[0]);
        conditions.push(`d.monthly_price >= ${p(monthlyMin)}`);
        if (filters.monthly_price.length >= 2 && shouldApplyRangeMax(monthlyMin, Number(filters.monthly_price[1]))) {
            conditions.push(`d.monthly_price <= ${p(Number(filters.monthly_price[1]))}`);
        }
    }
    if (filters.deposit && Array.isArray(filters.deposit) && filters.deposit.length > 0) {
        if (isDepositExactZero(filters.deposit)) {
            conditions.push(`d.deposit = ${p(0)}`);
        }
        else {
            const depositMin = Number(filters.deposit[0]);
            conditions.push(`d.deposit >= ${p(depositMin)}`);
            if (filters.deposit.length >= 2 && shouldApplyRangeMax(depositMin, Number(filters.deposit[1]))) {
                conditions.push(`d.deposit <= ${p(Number(filters.deposit[1]))}`);
            }
        }
    }
    if (filters.lease_period && Array.isArray(filters.lease_period) && filters.lease_period.length > 0) {
        const leaseMin = Number(filters.lease_period[0]);
        conditions.push(`d.lease_period >= ${p(leaseMin)}`);
        if (filters.lease_period.length >= 2 && shouldApplyRangeMax(leaseMin, Number(filters.lease_period[1]))) {
            conditions.push(`d.lease_period <= ${p(Number(filters.lease_period[1]))}`);
        }
    }
    if (filters.mileage && Array.isArray(filters.mileage) && filters.mileage.length > 0) {
        const me = "COALESCE(NULLIF(d.yearly_mileage, 0), d.mileage)";
        const mileageMin = Number(filters.mileage[0]);
        conditions.push(`${me} >= ${p(mileageMin)}`);
        if (filters.mileage.length >= 2 && shouldApplyRangeMax(mileageMin, Number(filters.mileage[1]))) {
            conditions.push(`${me} <= ${p(Number(filters.mileage[1]))}`);
        }
    }
    // Inclusion — jsonb array of strings e.g. ["1","3"]
    if (filters.inclusion && Array.isArray(filters.inclusion) && filters.inclusion.length > 0) {
        const or = filters.inclusion.map((inc) => `d.inclusion @> ${p(JSON.stringify([String(inc)]))}::jsonb`);
        conditions.push(`d.inclusion IS NOT NULL AND (${or.join(" OR ")})`);
    }
    // --- Car-level fields (dc = mvpw1_10, mostly flat columns) ---
    // Make — dc.make is jsonb {"id":N,"name":"…"}
    if (filters.make && Array.isArray(filters.make) && filters.make.length > 0) {
        const or = filters.make.map((id) => `(dc.make->>'id')::integer = ${p(Number(id))}`);
        conditions.push(`(${or.join(" OR ")})`);
    }
    // Model — dc.model is jsonb {"id":N,"name":"…"}
    if (filters.model && Array.isArray(filters.model) && filters.model.length > 0) {
        const or = filters.model.map((id) => `(dc.model->>'id')::integer = ${p(Number(id))}`);
        conditions.push(`(${or.join(" OR ")})`);
    }
    if (filters.fuel && Array.isArray(filters.fuel) && filters.fuel.length > 0) {
        conditions.push(`dc.fuel IN ${inList(filters.fuel)}`);
    }
    if (filters.transmission && Array.isArray(filters.transmission) && filters.transmission.length > 0) {
        conditions.push(`dc.transmission IN ${inList(filters.transmission)}`);
    }
    if (filters.body && Array.isArray(filters.body) && filters.body.length > 0) {
        conditions.push(`dc.body IN ${inList(filters.body)}`);
    }
    if (filters.tax_class && Array.isArray(filters.tax_class) && filters.tax_class.length > 0) {
        conditions.push(`dc.tax_class IN ${inList(filters.tax_class)}`);
    }
    if (filters.wheel_drive && Array.isArray(filters.wheel_drive) && filters.wheel_drive.length > 0) {
        conditions.push(`dc.wheel_drive IN ${inList(filters.wheel_drive)}`);
    }
    if (filters.color && Array.isArray(filters.color) && filters.color.length > 0) {
        conditions.push(`dc.color IN ${inList(filters.color)}`);
    }
    // Seat — flat integer column
    if (filters.seat && Array.isArray(filters.seat) && filters.seat.length > 0) {
        conditions.push(`dc.seat IN ${inList(filters.seat.map((s) => Number(s)))}`);
    }
    if (filters.seat_range && Array.isArray(filters.seat_range) && filters.seat_range.length > 0) {
        conditions.push(`dc.seat >= ${p(Number(filters.seat_range[0]))}`);
        if (filters.seat_range.length >= 2) {
            conditions.push(`dc.seat <= ${p(Number(filters.seat_range[1]))}`);
        }
    }
    // Spec — jsonb array of strings e.g. ["1","2","6"]
    if (filters.spec && Array.isArray(filters.spec) && filters.spec.length > 0) {
        const or = filters.spec.map((s) => `dc.spec @> ${p(JSON.stringify([String(s)]))}::jsonb`);
        conditions.push(`dc.spec IS NOT NULL AND (${or.join(" OR ")})`);
    }
    // Batterycap — flat integer column
    if (filters.batterycap && Array.isArray(filters.batterycap) && filters.batterycap.length > 0) {
        const bcArr = filters.batterycap.filter((v) => v !== null && v !== undefined);
        if (bcArr.length > 0) {
            const minVal = filters.batterycap[0];
            const maxVal = filters.batterycap.length >= 2 ? filters.batterycap[1] : undefined;
            if (minVal !== null && minVal !== undefined) {
                conditions.push(`dc.batterycap >= ${p(Number(minVal))}`);
            }
            if (maxVal !== null && maxVal !== undefined) {
                conditions.push(`dc.batterycap <= ${p(Number(maxVal))}`);
            }
        }
    }
    const whereClause = conditions.length > 0 ?
        `WHERE ${conditions.join(" AND ")}` :
        "";
    return { whereClause, params };
};
/**
 * Fetches deals from PlanetScale (flat-column schema, no xdo wrapper).
 * Completely independent from ClickHouse and Xano PostgreSQL paths.
 */
async function getPlanetScaleDeals(filters, consumerId, favoritedDealIds, page, perPage, isDebugProfile, debugProfileId) {
    var _a;
    const { whereClause, params: whereParams } = buildPlanetScaleWhereClause(filters, favoritedDealIds);
    if (isDebugProfile) {
        console.log("matching-planetscale-query-formation", {
            debugProfileId,
            whereClause,
            whereParams,
        });
    }
    // Count
    const countQuery = `
    SELECT COUNT(*) as total
    FROM mvpw1_13 d
    LEFT JOIN mvpw1_10 dc ON d.dealership_car_id = dc.id
    ${whereClause}
  `;
    const countResult = await (0, pg_1.executePlanetScaleQuery)(countQuery, [...whereParams]);
    const total = Number(((_a = countResult.rows[0]) === null || _a === void 0 ? void 0 : _a.total) || 0);
    const totalPages = Math.ceil(total / perPage);
    if (page > totalPages && totalPages > 0) {
        return {
            items: [],
            curPage: page,
            nextPage: null,
            prevPage: totalPages > 0 ? totalPages : null,
            total,
            perPage,
            totalPages,
        };
    }
    const offset = (page - 1) * perPage;
    const limitIdx = whereParams.length + 1;
    const offsetIdx = whereParams.length + 2;
    const dataQuery = `
    SELECT
      d.id,
      d.monthly_price,
      d.deposit,
      d.lease_period,
      d.mileage       as deal_mileage,
      d.yearly_mileage,
      d.dealership_car_id,
      d.dealership_id,
      d.inclusion,
      d.sale_status,
      dc.id            as car_id,
      dc.fuel,
      dc.body,
      dc.seat,
      dc.tax_class,
      dc.transmission,
      dc.wheel_drive,
      dc.color,
      dc.mileage       as car_mileage,
      dc.batterycap,
      dc.horsepower,
      dc.weight,
      dc.make          as car_make,
      dc.model         as car_model,
      dc.spec,
      dc.model_variant,
      dc.registration_date,
      dc.media,
      dc.dealership_id as car_dealership_id,
      dc.internal_label as car_internal_label,
      dc.description   as car_description,
      make.id          as make_id,
      make.name        as make_name,
      model.id         as model_id,
      model.name       as model_name
    FROM mvpw1_13 d
    LEFT JOIN mvpw1_10 dc    ON d.dealership_car_id = dc.id
    LEFT JOIN mvpw1_31 make  ON (dc.make->>'id')::integer = make.id
    LEFT JOIN mvpw1_33 model ON (dc.model->>'id')::integer = model.id
    ${whereClause}
    ${buildPlanetScaleOrderBy(filters.sort)}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
    const result = await (0, pg_1.executePlanetScaleQuery)(dataQuery, [...whereParams, perPage, offset]);
    if (isDebugProfile) {
        console.log("matching-planetscale-fetch-result", {
            debugProfileId,
            rowsReturned: result.rows.length,
            first20Ids: result.rows.slice(0, 20).map((r) => r.id),
        });
    }
    const parseNumber = (value) => {
        if (value === null || value === undefined)
            return undefined;
        const num = Number(value);
        return isNaN(num) ? undefined : num;
    };
    const deals = result.rows.map((row) => {
        const deal = {
            id: row.id,
            created_at: new Date(),
            monthly_price: parseNumber(row.monthly_price),
            deposit: parseNumber(row.deposit),
            lease_period: parseNumber(row.lease_period),
            dealership_car_id: row.dealership_car_id || "",
            dealership_id: row.dealership_id || "",
            mileage: parseNumber(row.deal_mileage),
            yearly_mileage: parseNumber(row.yearly_mileage),
            sale_status: row.sale_status,
        };
        // Parse inclusion (jsonb array of strings → [{id: N}])
        const incRaw = row.inclusion;
        if (Array.isArray(incRaw)) {
            deal.inclusion = incRaw
                .map((v) => ({ id: Number(v) }))
                .filter((i) => !isNaN(i.id) && i.id > 0);
        }
        // Parse car
        if (row.car_id) {
            const carMake = row.car_make;
            const carModel = row.car_model;
            const makeName = row.make_name || (carMake === null || carMake === void 0 ? void 0 : carMake.name);
            const modelName = row.model_name || (carModel === null || carModel === void 0 ? void 0 : carModel.name);
            const parseDate = (value) => {
                if (!value)
                    return undefined;
                if (value instanceof Date)
                    return value;
                if (typeof value === "string") {
                    const d = new Date(value);
                    return isNaN(d.getTime()) ? undefined : d;
                }
                return undefined;
            };
            deal.car = {
                id: row.car_id,
                created_at: new Date(),
                dealership_id: row.car_dealership_id || deal.dealership_id,
                make: makeName,
                make_id: parseNumber(row.make_id) || parseNumber(carMake === null || carMake === void 0 ? void 0 : carMake.id),
                model: modelName,
                model_id: parseNumber(row.model_id) || parseNumber(carModel === null || carModel === void 0 ? void 0 : carModel.id),
                model_variant: row.model_variant,
                registration_date: parseDate(row.registration_date),
                fuel: row.fuel,
                transmission: row.transmission,
                color: row.color,
                body: row.body,
                tax_class: row.tax_class,
                mileage: parseNumber(row.car_mileage),
                weight: parseNumber(row.weight),
                horsepower: parseNumber(row.horsepower),
                batterycap: parseNumber(row.batterycap),
                spec: Array.isArray(row.spec) ?
                    row.spec.map((v) => Number(v)).filter((n) => !isNaN(n)) :
                    undefined,
                wheel_drive: row.wheel_drive,
                media: row.media,
            };
        }
        return deal;
    });
    // Favourites
    let favoritedSet = new Set();
    if (consumerId && deals.length > 0) {
        favoritedSet = await (0, auth_1.getFavoritedDealIds)(consumerId, deals.map((d) => d.id));
    }
    const items = deals.map((deal) => (Object.assign(Object.assign({}, deal), { favourite: consumerId ? favoritedSet.has(deal.id) : false })));
    return {
        items,
        curPage: page,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
        total,
        perPage,
        totalPages,
    };
}
/**
 * Retrieves deals from the database with associated car details and pagination.
 * All filters are optional and will be applied only if provided.
 *
 * @param {DealFilters} filters Optional filters to apply to the query, including pagination.
 * @param {string | null} consumerId Optional consumer ID to check for favorited deals.
 * @param {string[] | null} favoritedDealIds Optional array of deal IDs to filter by (for favourites only).
 * @return {Promise<PaginatedDealsResult>} Paginated deals with car details and pagination metadata.
 */
const getDeals = async (filters = {}, consumerId = null, favoritedDealIds = null, useClickHouse = false, usePlanetScale = false) => {
    var _a;
    const debugProfileId = filters._debugProfileId;
    const isDebugProfile = debugProfileId === "bcff9ef6-b223-4720-89fb-02f0080ac9cc";
    // Ensure page and perPage are always integers
    const rawPage = filters.page !== undefined ? filters.page : 1;
    const page = Math.max(1, Math.floor(typeof rawPage === "number" ? rawPage : parseInt(String(rawPage), 10) || 1));
    const rawPerPage = filters.perPage !== undefined ? filters.perPage : 20;
    const perPage = Math.max(1, Math.floor(typeof rawPerPage === "number" ? rawPerPage : parseInt(String(rawPerPage), 10) || 20));
    // PlanetScale fast path — completely independent from PostgreSQL/ClickHouse
    if (usePlanetScale) {
        return getPlanetScaleDeals(filters, consumerId, favoritedDealIds, page, perPage, isDebugProfile, debugProfileId);
    }
    // Debug logging
    console.log("getDeals - Pagination params:", {
        page,
        perPage,
        filtersPage: filters.page,
        filtersPerPage: filters.perPage,
    });
    const hasLocationFilter = filters.location !== undefined &&
        filters.location.lat !== undefined &&
        filters.location.long !== undefined;
    const hasCityFilter = filters.city !== undefined &&
        Array.isArray(filters.city) &&
        filters.city.length > 0;
    const hasRegionFilter = filters.region !== undefined &&
        Array.isArray(filters.region) &&
        filters.region.length > 0;
    const { whereClause, params: whereParams } = buildWhereClause(filters, favoritedDealIds);
    // Check if any filters are applied (excluding pagination, status filter, and favourites)
    // If no filters are applied, show only one deal per dealership
    // Note: whereClause always includes status filter, so we check if it has more than just status
    const hasSortFilter = filters.sort !== undefined && filters.sort !== null && filters.sort !== "";
    // Check if whereClause has more than just the status filter (status filter is always first: "d.xdo->>'status' = $1")
    const hasFiltersBeyondStatus = whereClause !== "" && whereClause.split(" AND ").length > 1;
    const hasAnyFilters = hasFiltersBeyondStatus || hasLocationFilter || hasCityFilter || hasRegionFilter || hasSortFilter || (favoritedDealIds !== null);
    const showUniqueDealerships = !hasAnyFilters;
    // Build distance calculation and city lookup if location filter is provided
    // Also build city lookup if city filter is provided (to return city name in response)
    // Also build region lookup if region filter is provided (to return region name in response)
    let distanceSelect = "";
    let citySelect = "";
    let regionSelect = "";
    let distanceJoin = "";
    let cityJoin = ""; // Join for city/region filter (even without location filter)
    // Build ORDER BY clause based on sort filter
    // Default is created_at DESC unless sort is specified or location/favorites filters override it
    // created_at DESC is always appended as a tiebreaker so rows with equal sort values
    // have a stable, deterministic order (prevents duplicates/skips across paginated pages).
    const createdAtDesc = "to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) DESC";
    let orderByClause = `ORDER BY ${createdAtDesc}`;
    // Apply sort filter if provided (location and favorites filters can override this).
    // Each case sets only the primary sort expression; the created_at DESC tiebreaker
    // is appended below so it always applies "on top of" the requested sort.
    if (filters.sort) {
        let primarySort = null;
        switch (filters.sort) {
            case "monthly_price_asc":
                primarySort = "(d.xdo->>'monthly_price')::bigint ASC NULLS LAST";
                break;
            case "monthly_price_desc":
                primarySort = "(d.xdo->>'monthly_price')::bigint DESC NULLS LAST";
                break;
            case "deposit_asc":
                primarySort = "(d.xdo->>'deposit')::bigint ASC NULLS LAST";
                break;
            case "deposit_desc":
                primarySort = "(d.xdo->>'deposit')::bigint DESC NULLS LAST";
                break;
            case "mileage_asc":
                primarySort = "(d.xdo->>'mileage')::bigint ASC NULLS LAST";
                break;
            case "mileage_desc":
                primarySort = "(d.xdo->>'mileage')::bigint DESC NULLS LAST";
                break;
            case "published_asc":
                primarySort = "to_timestamp((d.xdo->>'published_at')::numeric / 1000.0) ASC NULLS LAST";
                break;
            case "published_desc":
                primarySort = "to_timestamp((d.xdo->>'published_at')::numeric / 1000.0) DESC NULLS LAST";
                break;
            case "registration_year_asc":
                // Extract year from registration_date in car table
                // Handle both numeric timestamps (milliseconds or seconds) and date strings
                primarySort = `(
          CASE
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'number' THEN
              EXTRACT(YEAR FROM to_timestamp((dc.xdo->>'registration_date')::numeric /
                CASE WHEN (dc.xdo->>'registration_date')::numeric > 1000000000000 THEN 1.0 ELSE 1000.0 END))
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'string' AND (dc.xdo->>'registration_date') ~ '^[0-9]+$' THEN
              EXTRACT(YEAR FROM to_timestamp((dc.xdo->>'registration_date')::numeric /
                CASE WHEN (dc.xdo->>'registration_date')::numeric > 1000000000000 THEN 1.0 ELSE 1000.0 END))
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'string' THEN
              EXTRACT(YEAR FROM (dc.xdo->>'registration_date')::date)
            ELSE NULL
          END
        ) ASC NULLS LAST`;
                break;
            case "registration_year_desc":
                // Extract year from registration_date in car table
                // Handle both numeric timestamps (milliseconds or seconds) and date strings
                primarySort = `(
          CASE
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'number' THEN
              EXTRACT(YEAR FROM to_timestamp((dc.xdo->>'registration_date')::numeric /
                CASE WHEN (dc.xdo->>'registration_date')::numeric > 1000000000000 THEN 1.0 ELSE 1000.0 END))
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'string' AND (dc.xdo->>'registration_date') ~ '^[0-9]+$' THEN
              EXTRACT(YEAR FROM to_timestamp((dc.xdo->>'registration_date')::numeric /
                CASE WHEN (dc.xdo->>'registration_date')::numeric > 1000000000000 THEN 1.0 ELSE 1000.0 END))
            WHEN jsonb_typeof(dc.xdo->'registration_date') = 'string' THEN
              EXTRACT(YEAR FROM (dc.xdo->>'registration_date')::date)
            ELSE NULL
          END
        ) DESC NULLS LAST`;
                break;
        }
        // Append created_at DESC as a secondary key on top of the requested sort.
        // Unrecognized sort values leave primarySort null and fall back to the default above.
        if (primarySort) {
            orderByClause = `ORDER BY ${primarySort}, ${createdAtDesc}`;
        }
    }
    // Separate params: count query only needs WHERE params, main query needs WHERE + location params
    // If radius is provided, we also need location params in count query for filtering
    const hasRadius = hasLocationFilter && ((_a = filters.location) === null || _a === void 0 ? void 0 : _a.radius) !== undefined && filters.location.radius > 0;
    const countParams = [...whereParams];
    const mainParams = [...whereParams];
    // Helper function to generate distance calculation expression
    // This is used in both SELECT (for displaying distance) and WHERE (for filtering by radius)
    const getDistanceExpression = (latParamIndex, lngParamIndex) => {
        return `CASE
          WHEN dl.xdo->'location'->>'geopoint' IS NOT NULL 
               AND dl.xdo->'location'->>'geopoint' != ''
               AND dl.xdo->'location'->>'geopoint' != 'null' THEN
            (
              ST_DistanceSphere(
                ST_MakePoint($${lngParamIndex}, $${latParamIndex}),
                ST_GeomFromText(dl.xdo->'location'->>'geopoint', 4326)
              ) / 1000.0
            )
          ELSE
            NULL
        END`;
    };
    let radiusFilterCondition = "";
    if (hasLocationFilter && filters.location) {
        // Add location params to count params if radius is provided (needed for filtering)
        // Otherwise, only add to main params (for SELECT distance calculation)
        if (hasRadius) {
            // Add location params to count params for radius filtering
            countParams.push(filters.location.lat);
            countParams.push(filters.location.long);
        }
        // Add location params to main query params
        mainParams.push(filters.location.lat);
        mainParams.push(filters.location.long);
        // Calculate parameter indices
        const mainLatParam = mainParams.length - 1;
        const mainLngParam = mainParams.length;
        // Use PostGIS to calculate distance in SELECT clause
        // Geopoint is stored as PostGIS POINT string: "POINT(longitude latitude)" e.g. "POINT(8.552376 60.8630648)"
        // Convert the string to PostGIS geometry and calculate distance using ST_DistanceSphere
        // Returns distance in meters, convert to kilometers by dividing by 1000
        // Handle NULL geopoint by returning NULL distance
        distanceSelect = `, ${getDistanceExpression(mainLatParam, mainLngParam)} as distance`;
        // Select municipality name from mvpw1_62 table
        // Handle case where muncipality field might be empty/null
        // Municipality can be stored as number or string in JSONB
        // Extract municipality ID safely and join with municipality table
        citySelect = `,
        (
          SELECT muni.xdo->>'name'
          FROM public.mvpw1_62 muni
          WHERE (
            -- If municipality is stored as a number, extract it directly
            (jsonb_typeof(dl.xdo->'location'->'muncipality') = 'number' 
             AND (dl.xdo->'location'->'muncipality')::integer IS NOT NULL
             AND muni.id = (dl.xdo->'location'->'muncipality')::integer)
            OR
            -- If municipality is stored as a string, validate and convert
            (jsonb_typeof(dl.xdo->'location'->'muncipality') = 'string'
             AND dl.xdo->'location'->>'muncipality' IS NOT NULL
             AND dl.xdo->'location'->>'muncipality' != ''
             AND (dl.xdo->'location'->>'muncipality') ~ '^[0-9]+$'
             AND muni.id = (dl.xdo->'location'->>'muncipality')::integer)
          )
          LIMIT 1
        ) as city`;
        // Select country name (region) from country table
        // Handle case where country field might be empty/null
        // Country can be stored as number or string in JSONB
        // Extract country ID safely and join with country table
        // Note: Table name needs to be confirmed - using mvpw1_XX pattern similar to municipality
        regionSelect = `,
        (
          SELECT country.xdo->>'name'
          FROM public.mvpw1_63 country
          WHERE (
            -- If country is stored as a number, extract it directly
            (jsonb_typeof(dl.xdo->'location'->'country') = 'number' 
             AND (dl.xdo->'location'->'country')::integer IS NOT NULL
             AND country.id = (dl.xdo->'location'->'country')::integer)
            OR
            -- If country is stored as a string, validate and convert
            (jsonb_typeof(dl.xdo->'location'->'country') = 'string'
             AND dl.xdo->'location'->>'country' IS NOT NULL
             AND dl.xdo->'location'->>'country' != ''
             AND (dl.xdo->'location'->>'country') ~ '^[0-9]+$'
             AND country.id = (dl.xdo->'location'->>'country')::integer)
          )
          LIMIT 1
        ) as region`;
        // Join with dealership table (mvpw1_6) to get location data
        // Join with municipality table (mvpw1_62) is done in subquery above
        distanceJoin = "INNER JOIN public.mvpw1_6 dl ON (d.xdo->>'dealership_id')::uuid = dl.id";
        // When location filter is provided, sort by distance ASC (unless sort filter is specified)
        // But if favorites are also filtered, prioritize created_at DESC (unless sort filter is specified)
        if (!filters.sort) {
            if (favoritedDealIds !== null) {
                // Favorites filtered: sort by created_at DESC first
                orderByClause = "ORDER BY to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) DESC";
            }
            else {
                // No favorites: sort by distance ASC
                orderByClause = "ORDER BY distance ASC";
            }
        }
    }
    // Always add city and region select and join (unless location filter already provides it)
    // This allows returning city name in response by default
    if (!hasLocationFilter) {
        // Use same join alias for both city and region lookups
        const dlAlias = "dl_loc";
        cityJoin = `LEFT JOIN public.mvpw1_6 ${dlAlias} ON (d.xdo->>'dealership_id')::uuid = ${dlAlias}.id`;
        // Always select municipality name (city) by default
        citySelect = `,
        (
          SELECT muni.xdo->>'name'
          FROM public.mvpw1_62 muni
          WHERE (
            -- If municipality is stored as a number, extract it directly
            (jsonb_typeof(${dlAlias}.xdo->'location'->'muncipality') = 'number' 
             AND (${dlAlias}.xdo->'location'->'muncipality')::integer IS NOT NULL
             AND muni.id = (${dlAlias}.xdo->'location'->'muncipality')::integer)
            OR
            -- If municipality is stored as a string, validate and convert
            (jsonb_typeof(${dlAlias}.xdo->'location'->'muncipality') = 'string'
             AND ${dlAlias}.xdo->'location'->>'muncipality' IS NOT NULL
             AND ${dlAlias}.xdo->'location'->>'muncipality' != ''
             AND (${dlAlias}.xdo->'location'->>'muncipality') ~ '^[0-9]+$'
             AND muni.id = (${dlAlias}.xdo->'location'->>'muncipality')::integer)
          )
          LIMIT 1
        ) as city`;
        // Always select country name (region) by default
        // Note: Table name needs to be confirmed - using mvpw1_63 pattern similar to municipality
        regionSelect = `,
        (
          SELECT country.xdo->>'name'
          FROM public.mvpw1_63 country
          WHERE (
            -- If country is stored as a number, extract it directly
            (jsonb_typeof(${dlAlias}.xdo->'location'->'country') = 'number' 
             AND (${dlAlias}.xdo->'location'->'country')::integer IS NOT NULL
             AND country.id = (${dlAlias}.xdo->'location'->'country')::integer)
            OR
            -- If country is stored as a string, validate and convert
            (jsonb_typeof(${dlAlias}.xdo->'location'->'country') = 'string'
             AND ${dlAlias}.xdo->'location'->>'country' IS NOT NULL
             AND ${dlAlias}.xdo->'location'->>'country' != ''
             AND (${dlAlias}.xdo->'location'->>'country') ~ '^[0-9]+$'
             AND country.id = (${dlAlias}.xdo->'location'->>'country')::integer)
          )
          LIMIT 1
        ) as region`;
    }
    // If radius is provided, add distance filter to WHERE clause
    if (hasLocationFilter && hasRadius && filters.location) {
        // Add radius param to both count and main params
        // At this point, both arrays have: [...whereParams, lat, lng]
        countParams.push(filters.location.radius);
        mainParams.push(filters.location.radius);
        // After adding radius, both arrays have: [...whereParams, lat, lng, radius]
        // Calculate parameter indices (same for both count and main queries)
        // lat is at position: array.length - 2
        // lng is at position: array.length - 1
        // radius is at position: array.length
        const latParam = countParams.length - 2;
        const lngParam = countParams.length - 1;
        const radiusParam = countParams.length;
        // Create radius filter condition using distance calculation
        // Repeat the distance calculation in WHERE clause since we can't use SELECT aliases
        // This condition works for both count and main queries because they have the same param structure
        const distanceExpr = getDistanceExpression(latParam, lngParam);
        radiusFilterCondition = ` AND ${distanceExpr} <= $${radiusParam} AND ${distanceExpr} IS NOT NULL`;
    }
    // Get total count of records matching filters
    // Use LEFT JOIN to include deals with null dealership_car_id
    // Include same joins as main query for accurate count
    // Use countParams (WHERE params + location params if radius provided) for COUNT query
    // Count all active deals (not distinct dealerships)
    const countQuery = showUniqueDealerships ? `
      SELECT COUNT(*) as total
      FROM public.mvpw1_13 d
      WHERE d.xdo->>'status' = 'active'
    ` : `
      SELECT COUNT(*) as total
      FROM public.mvpw1_13 d
      LEFT JOIN public.mvpw1_10 dc ON (d.xdo->>'dealership_car_id')::uuid = dc.id
      LEFT JOIN public.mvpw1_31 make ON (dc.xdo->'make'->>'id')::integer = make.id
      LEFT JOIN public.mvpw1_33 model ON (dc.xdo->'model'->>'id')::integer = model.id
      ${hasLocationFilter ? distanceJoin : ""}
      ${!hasLocationFilter ? cityJoin : ""}
      ${whereClause}${radiusFilterCondition}
    `;
    // Use empty params for count query if showing unique dealerships (no filters)
    const countQueryParams = showUniqueDealerships ? [] : countParams;
    const countResult = await (0, pg_1.executeQuery)(countQuery, countQueryParams);
    const total = Number(countResult.rows[0].total);
    // If showing unique dealerships, we need to calculate total deals (not just distinct dealerships)
    // First get the count of distinct dealerships, then we'll calculate total pages based on actual deals
    let totalPages;
    if (showUniqueDealerships) {
        // Simple query: just get all active deals sorted by created_at DESC
        totalPages = Math.ceil(total / perPage);
        // If page is beyond total pages, return empty results
        if (page > totalPages && totalPages > 0) {
            return {
                items: [],
                curPage: page,
                nextPage: null,
                prevPage: totalPages > 0 ? totalPages : null,
                total,
                perPage,
                totalPages,
            };
        }
        const offset = (page - 1) * perPage;
        const limitParam = 1;
        const offsetParam = 2;
        const query = `
      SELECT 
        d.id,
        d.xdo as deal_data,
        dc.xdo as car_data,
        dc.id as car_id,
        make.id as make_id,
        make.xdo as make_data,
        model.id as model_id,
        model.xdo as model_data,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', inc.id,
                'data', inc.xdo
              )
            )
            FROM jsonb_array_elements_text(
              CASE 
                WHEN d.xdo->'inclusion' IS NOT NULL 
                     AND jsonb_typeof(d.xdo->'inclusion') = 'array'
                THEN d.xdo->'inclusion'
                ELSE '[]'::jsonb
              END
            ) AS elem
            LEFT JOIN public.mvpw1_37 inc ON (elem::integer) = inc.id
            WHERE inc.id IS NOT NULL
          ),
          '[]'::jsonb
        ) as inclusion_data
        ${distanceSelect}
        ${citySelect}
        ${regionSelect},
        (
          SELECT COUNT(*)
          FROM public.x1_39
          WHERE deal_id = d.id
          AND source = 'marketplace'
        ) as request_count
      FROM public.mvpw1_13 d
      LEFT JOIN public.mvpw1_10 dc ON (d.xdo->>'dealership_car_id')::uuid = dc.id
      LEFT JOIN public.mvpw1_31 make ON (dc.xdo->'make'->>'id')::integer = make.id
      LEFT JOIN public.mvpw1_33 model ON (dc.xdo->'model'->>'id')::integer = model.id
      ${distanceJoin}
      ${!hasLocationFilter ? cityJoin : ""}
      WHERE d.xdo->>'status' = 'active'
      ORDER BY to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
        const result = await (0, pg_1.executeQuery)(query, [perPage, offset]);
        const deals = result.rows.map((row) => {
            var _a, _b, _c;
            // PostgreSQL returns JSONB as JavaScript objects
            const dealData = row.deal_data || {};
            const carData = row.car_data || null;
            const makeData = row.make_data || null;
            const modelData = row.model_data || null;
            const inclusionData = row.inclusion_data || null;
            // Parse deal fields from JSONB
            const parseNumber = (value) => {
                if (value === null || value === undefined)
                    return undefined;
                const num = Number(value);
                return isNaN(num) ? undefined : num;
            };
            const parseArray = (value) => {
                if (!value)
                    return undefined;
                if (Array.isArray(value)) {
                    return value.map((v) => parseNumber(v)).filter((v) => v !== undefined);
                }
                return undefined;
            };
            const parseInclusionArray = (value) => {
                if (value === null || value === undefined)
                    return undefined;
                if (Array.isArray(value)) {
                    if (value.length === 0)
                        return [];
                    return value
                        .map((item) => {
                        if (item && typeof item === "object" && "id" in item) {
                            const inclusionItem = {
                                id: parseNumber(item.id) || 0,
                            };
                            if ("data" in item && item.data && typeof item.data === "object") {
                                Object.assign(inclusionItem, item.data);
                            }
                            return inclusionItem;
                        }
                        return null;
                    })
                        .filter((item) => item !== null && item.id > 0);
                }
                return undefined;
            };
            // Build deal object
            const deal = {
                id: row.id,
                created_at: new Date(),
                monthly_price: parseNumber(dealData.monthly_price),
                deposit: parseNumber(dealData.deposit),
                lease_period: parseNumber(dealData.lease_period),
                dealership_car_id: dealData.dealership_car_id || "",
                dealership_id: dealData.dealership_id || "",
                inclusion: parseInclusionArray(inclusionData) || ((_a = parseArray(dealData.inclusion)) === null || _a === void 0 ? void 0 : _a.map((id) => ({ id }))) || undefined,
                mileage: parseNumber(dealData.mileage),
                yearly_mileage: parseNumber(dealData.yearly_mileage),
                sale_status: dealData.sale_status,
            };
            // Parse car fields
            if (carData && typeof carData === "object" && Object.keys(carData).length > 0 && row.car_id) {
                let make;
                if (makeData && typeof makeData === "object" && row.make_id) {
                    const makeName = makeData.name;
                    if (makeName) {
                        make = makeName;
                    }
                }
                else {
                    const carMake = carData.make;
                    if (carMake) {
                        if (typeof carMake === "object" && carMake.name) {
                            make = carMake.name;
                        }
                        else if (typeof carMake === "string") {
                            make = carMake;
                        }
                    }
                }
                let model;
                if (modelData && typeof modelData === "object" && row.model_id) {
                    const modelName = modelData.name;
                    if (modelName) {
                        model = modelName;
                    }
                }
                else {
                    const carModel = carData.model;
                    if (carModel) {
                        if (typeof carModel === "object" && carModel.name) {
                            model = carModel.name;
                        }
                        else if (typeof carModel === "string") {
                            model = carModel;
                        }
                    }
                }
                const parseDate = (value) => {
                    if (!value)
                        return undefined;
                    if (value instanceof Date)
                        return value;
                    if (typeof value === "number") {
                        return new Date(value > 1000000000000 ? value : value * 1000);
                    }
                    if (typeof value === "string") {
                        const num = Number(value);
                        if (!isNaN(num)) {
                            return new Date(num > 1000000000000 ? num : num * 1000);
                        }
                        const date = new Date(value);
                        return isNaN(date.getTime()) ? undefined : date;
                    }
                    return undefined;
                };
                deal.car = {
                    id: row.car_id,
                    created_at: new Date(),
                    dealership_id: carData.dealership_id || deal.dealership_id,
                    make: make,
                    make_id: parseNumber(row.make_id) || parseNumber((_b = carData.make) === null || _b === void 0 ? void 0 : _b.id),
                    model: model,
                    model_id: parseNumber(row.model_id) || parseNumber((_c = carData.model) === null || _c === void 0 ? void 0 : _c.id),
                    model_variant: carData.model_variant,
                    vin: carData.vin,
                    registration_date: parseDate(carData.registration_date),
                    registration_number: carData.registration_number,
                    status: carData.status,
                    sale_status: carData.sale_status,
                    hitme: carData.hitme,
                    door: parseNumber(carData.door),
                    seat: parseNumber(carData.seat),
                    fuel: carData.fuel,
                    transmission: carData.transmission,
                    color: typeof carData.color === "number" ? String(carData.color) : carData.color,
                    body: typeof carData.body === "number" ? String(carData.body) : carData.body,
                    tax_class: carData.tax_class,
                    description: carData.description,
                    mileage: parseNumber(carData.mileage),
                    weight: parseNumber(carData.weight),
                    horsepower: parseNumber(carData.horsepower),
                    batterycap: parseNumber(carData.batterycap),
                    spec: carData.spec,
                    wheel_drive: carData.wheel_drive,
                    image: carData.image,
                    media: carData.media,
                    internal_label: carData.internal_label,
                };
            }
            // Always include city from municipality (can be null) by default
            const city = row.city;
            if (city !== null && city !== undefined && typeof city === "string") {
                deal.city = city;
            }
            else {
                // Include null city by default
                deal.city = null;
            }
            // Always include request_count from x1_39 table
            const requestCount = row.request_count;
            if (requestCount !== null && requestCount !== undefined) {
                deal.request_count = Number(requestCount) || 0;
            }
            else {
                deal.request_count = 0;
            }
            return deal;
        });
        return {
            items: deals,
            curPage: page,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
            total,
            perPage,
            totalPages,
        };
    }
    else {
        // Normal query with filters
        totalPages = Math.ceil(total / perPage);
        // If page is beyond total pages, return empty results
        if (page > totalPages && totalPages > 0) {
            return {
                items: [],
                curPage: page,
                nextPage: null,
                prevPage: totalPages > 0 ? totalPages : null,
                total,
                perPage,
                totalPages,
            };
        }
        const offset = (page - 1) * perPage;
        const limitParam = mainParams.length + 1;
        const offsetParam = mainParams.length + 2;
        // Debug logging
        console.log("getDeals - Query params:", {
            page,
            perPage,
            offset,
            totalPages,
            total,
            limitParam,
            offsetParam,
            mainParamsLength: mainParams.length,
        });
        // Use ClickHouse if requested (for matching API)
        if (useClickHouse) {
            const { whereClause: clickHouseWhere, params: clickHouseParams, } = buildClickHouseWhereClause(filters, favoritedDealIds);
            const clickHouseQuery = `
        SELECT 
          d.id as id,
          d.xdo as deal_data,
          dc.xdo as car_data,
          dc.id as car_id,
          make.id as make_id,
          make.xdo as make_data,
          model.id as model_id,
          model.xdo as model_data,
          [] as inclusion_data,
          '' as city,
          '' as region,
          0 as request_count
        FROM mvpw1_13 d
        LEFT JOIN mvpw1_10 dc ON toUUIDOrNull(JSONExtractString(d.xdo, 'dealership_car_id')) = dc.id
        LEFT JOIN mvpw1_31 make ON JSONExtractInt(dc.xdo, 'make', 'id') = make.id
        LEFT JOIN mvpw1_33 model ON JSONExtractInt(dc.xdo, 'model', 'id') = model.id
        ${clickHouseWhere}
        ${buildClickHouseOrderBy(filters.sort)}
        LIMIT {limit:UInt64} OFFSET {offset:UInt64}
      `;
            clickHouseParams.limit = perPage;
            clickHouseParams.offset = offset;
            if (isDebugProfile) {
                console.log("matching-clickhouse-query-formation", {
                    debugProfileId,
                    clickHouseWhere,
                    clickHouseParams,
                    clickHouseQueryPreview: clickHouseQuery,
                });
            }
            const clickHouseResult = await (0, clickhouse_1.executeClickHouseQuery)(clickHouseQuery, clickHouseParams);
            const parseClickHouseJsonObject = (value) => {
                if (value === null || value === undefined)
                    return null;
                if (typeof value === "string") {
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                            return parsed;
                        }
                        return null;
                    }
                    catch (_a) {
                        return null;
                    }
                }
                if (typeof value === "object" && !Array.isArray(value)) {
                    return value;
                }
                return null;
            };
            // Map ClickHouse results to same format as PostgreSQL
            const deals = clickHouseResult.rows.map((row) => {
                var _a;
                const r = row;
                const dealData = parseClickHouseJsonObject(r.deal_data) || {};
                const carData = parseClickHouseJsonObject(r.car_data);
                const makeData = parseClickHouseJsonObject(r.make_data);
                const modelData = parseClickHouseJsonObject(r.model_data);
                const dealId = ((_a = r.id) !== null && _a !== void 0 ? _a : r["d.id"]);
                return {
                    id: dealId,
                    deal_data: dealData, // This now includes yearly_mileage if it was extracted
                    car_data: carData,
                    car_id: r.car_id,
                    make_id: r.make_id,
                    make_data: makeData,
                    model_id: r.model_id,
                    model_data: modelData,
                    inclusion_data: r.inclusion_data || [],
                    city: r.city || null,
                    region: r.region || null,
                    request_count: r.request_count || 0,
                };
            });
            if (isDebugProfile) {
                console.log("matching-clickhouse-fetch-result", {
                    debugProfileId,
                    rowsReturned: deals.length,
                    first20DealIds: deals.slice(0, 20).map((d) => d.id),
                });
            }
            // For ClickHouse, we'll use a simplified count (or skip count for performance)
            // Since ClickHouse is fast, we can do a separate count query if needed
            let total = deals.length; // Default to page size if count unavailable
            if (deals.length === perPage) {
                // If we got a full page, there might be more - do a count
                try {
                    const countQuery = `
            SELECT count() as total
            FROM mvpw1_13 d
            LEFT JOIN mvpw1_10 dc ON toUUIDOrNull(JSONExtractString(d.xdo, 'dealership_car_id')) = dc.id
            LEFT JOIN mvpw1_31 make ON JSONExtractInt(dc.xdo, 'make', 'id') = make.id
            LEFT JOIN mvpw1_33 model ON JSONExtractInt(dc.xdo, 'model', 'id') = model.id
            ${clickHouseWhere}
          `;
                    const countResult = await (0, clickhouse_1.executeClickHouseQuery)(countQuery, clickHouseParams);
                    if (countResult.rows.length > 0) {
                        const countRow = countResult.rows[0];
                        total = Number(countRow.total) || deals.length;
                    }
                }
                catch (error) {
                    // If count fails, use page size as estimate
                    total = deals.length;
                }
            }
            // Parse deals (same logic as PostgreSQL path)
            const parsedDeals = deals.map((row) => {
                var _a, _b, _c;
                const dealData = row.deal_data || {};
                const carData = row.car_data || null;
                const makeData = row.make_data || null;
                const modelData = row.model_data || null;
                const inclusionData = row.inclusion_data || null;
                // Parse deal fields (same as PostgreSQL)
                const parseNumber = (value) => {
                    if (value === null || value === undefined)
                        return undefined;
                    const num = Number(value);
                    return isNaN(num) ? undefined : num;
                };
                const parseArray = (value) => {
                    if (!value)
                        return undefined;
                    if (Array.isArray(value)) {
                        return value.map((v) => parseNumber(v)).filter((v) => v !== undefined);
                    }
                    return undefined;
                };
                const parseInclusionArray = (value) => {
                    if (value === null || value === undefined)
                        return undefined;
                    if (Array.isArray(value)) {
                        if (value.length === 0)
                            return [];
                        return value
                            .map((item) => {
                            if (item && typeof item === "object" && "id" in item) {
                                const inclusionItem = {
                                    id: parseNumber(item.id) || 0,
                                };
                                if ("data" in item && item.data && typeof item.data === "object") {
                                    Object.assign(inclusionItem, item.data);
                                }
                                return inclusionItem;
                            }
                            return null;
                        })
                            .filter((item) => item !== null && item.id > 0);
                    }
                    return undefined;
                };
                const parseDate = (value) => {
                    if (!value)
                        return undefined;
                    if (value instanceof Date)
                        return value;
                    if (typeof value === "number") {
                        return new Date(value > 1000000000000 ? value : value * 1000);
                    }
                    if (typeof value === "string") {
                        const num = Number(value);
                        if (!isNaN(num)) {
                            return new Date(num > 1000000000000 ? num : num * 1000);
                        }
                        const date = new Date(value);
                        return isNaN(date.getTime()) ? undefined : date;
                    }
                    return undefined;
                };
                // Build deal object
                const deal = {
                    id: row.id,
                    created_at: new Date(),
                    monthly_price: parseNumber(dealData.monthly_price),
                    deposit: parseNumber(dealData.deposit),
                    lease_period: parseNumber(dealData.lease_period),
                    dealership_car_id: dealData.dealership_car_id || "",
                    dealership_id: dealData.dealership_id || "",
                    inclusion: parseInclusionArray(inclusionData) || ((_a = parseArray(dealData.inclusion)) === null || _a === void 0 ? void 0 : _a.map((id) => ({ id }))) || undefined,
                    mileage: parseNumber(dealData.mileage),
                    yearly_mileage: parseNumber(dealData.yearly_mileage),
                    sale_status: dealData.sale_status,
                };
                // Parse car fields
                if (carData && typeof carData === "object" && Object.keys(carData).length > 0 && row.car_id) {
                    let make;
                    if (makeData && typeof makeData === "object" && row.make_id) {
                        const makeName = makeData.name;
                        if (makeName) {
                            make = makeName;
                        }
                    }
                    else {
                        const carMake = carData.make;
                        if (carMake) {
                            if (typeof carMake === "object" && carMake.name) {
                                make = carMake.name;
                            }
                            else if (typeof carMake === "string") {
                                make = carMake;
                            }
                        }
                    }
                    let model;
                    if (modelData && typeof modelData === "object" && row.model_id) {
                        const modelName = modelData.name;
                        if (modelName) {
                            model = modelName;
                        }
                    }
                    else {
                        const carModel = carData.model;
                        if (carModel) {
                            if (typeof carModel === "object" && carModel.name) {
                                model = carModel.name;
                            }
                            else if (typeof carModel === "string") {
                                model = carModel;
                            }
                        }
                    }
                    deal.car = {
                        id: row.car_id,
                        created_at: new Date(),
                        dealership_id: carData.dealership_id || deal.dealership_id,
                        make: make,
                        make_id: parseNumber(row.make_id) || parseNumber((_b = carData.make) === null || _b === void 0 ? void 0 : _b.id),
                        model: model,
                        model_id: parseNumber(row.model_id) || parseNumber((_c = carData.model) === null || _c === void 0 ? void 0 : _c.id),
                        model_variant: carData.model_variant,
                        registration_date: parseDate(carData.registration_date),
                        fuel: carData.fuel,
                        transmission: carData.transmission,
                        color: typeof carData.color === "number" ? String(carData.color) : carData.color,
                        body: typeof carData.body === "number" ? String(carData.body) : carData.body,
                        tax_class: carData.tax_class,
                        mileage: parseNumber(carData.mileage),
                        weight: parseNumber(carData.weight),
                        horsepower: parseNumber(carData.horsepower),
                        batterycap: parseNumber(carData.batterycap),
                        spec: parseArray(carData.spec),
                        wheel_drive: carData.wheel_drive,
                    };
                }
                return deal;
            });
            // Check favorites
            let favoritedDealIdsSet = new Set();
            if (consumerId && parsedDeals.length > 0) {
                const dealIds = parsedDeals.map((d) => d.id);
                favoritedDealIdsSet = await (0, auth_1.getFavoritedDealIds)(consumerId, dealIds);
            }
            const items = parsedDeals.map((deal) => (Object.assign(Object.assign({}, deal), { favourite: consumerId ? favoritedDealIdsSet.has(deal.id) : false })));
            return {
                items,
                curPage: page,
                nextPage: page < Math.ceil(total / perPage) ? page + 1 : null,
                prevPage: page > 1 ? page - 1 : null,
                total,
                perPage,
                totalPages: Math.ceil(total / perPage),
            };
        }
        // PostgreSQL query (original logic)
        const query = `
      SELECT 
        d.id,
        d.xdo as deal_data,
        dc.xdo as car_data,
        dc.id as car_id,
        make.id as make_id,
        make.xdo as make_data,
        model.id as model_id,
        model.xdo as model_data,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', inc.id,
                'data', inc.xdo
              )
            )
            FROM jsonb_array_elements_text(
              CASE 
                WHEN d.xdo->'inclusion' IS NOT NULL 
                     AND jsonb_typeof(d.xdo->'inclusion') = 'array'
                THEN d.xdo->'inclusion'
                ELSE '[]'::jsonb
              END
            ) AS elem
            LEFT JOIN public.mvpw1_37 inc ON (elem::integer) = inc.id
            WHERE inc.id IS NOT NULL
          ),
          '[]'::jsonb
        ) as inclusion_data
        ${distanceSelect}
        ${citySelect}
        ${regionSelect},
        (
          SELECT COUNT(*)
          FROM public.x1_39
          WHERE deal_id = d.id
          AND source = 'marketplace'
        ) as request_count
      FROM public.mvpw1_13 d
      LEFT JOIN public.mvpw1_10 dc ON (d.xdo->>'dealership_car_id')::uuid = dc.id
      LEFT JOIN public.mvpw1_31 make ON (dc.xdo->'make'->>'id')::integer = make.id
      LEFT JOIN public.mvpw1_33 model ON (dc.xdo->'model'->>'id')::integer = model.id
      ${distanceJoin}
      ${!hasLocationFilter ? cityJoin : ""}
      ${whereClause}${radiusFilterCondition}
      ${orderByClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
        const result = await (0, pg_1.executeQuery)(query, [...mainParams, perPage, offset]);
        const deals = result.rows.map((row) => {
            var _a, _b, _c;
            // PostgreSQL returns JSONB as JavaScript objects
            const dealData = row.deal_data || {};
            const carData = row.car_data || null;
            const makeData = row.make_data || null;
            const modelData = row.model_data || null;
            const inclusionData = row.inclusion_data || null;
            // Parse deal fields from JSONB
            const parseNumber = (value) => {
                if (value === null || value === undefined)
                    return undefined;
                const num = Number(value);
                return isNaN(num) ? undefined : num;
            };
            const parseArray = (value) => {
                if (!value)
                    return undefined;
                if (Array.isArray(value)) {
                    return value.map((v) => parseNumber(v)).filter((v) => v !== undefined);
                }
                return undefined;
            };
            const parseInclusionArray = (value) => {
                if (value === null || value === undefined)
                    return undefined;
                if (Array.isArray(value)) {
                    // Empty array is valid (no inclusions found)
                    if (value.length === 0)
                        return [];
                    return value
                        .map((item) => {
                        if (item && typeof item === "object" && "id" in item) {
                            const inclusionItem = {
                                id: parseNumber(item.id) || 0,
                            };
                            // Merge data from xdo if it exists
                            if ("data" in item && item.data && typeof item.data === "object") {
                                Object.assign(inclusionItem, item.data);
                            }
                            return inclusionItem;
                        }
                        return null;
                    })
                        .filter((item) => item !== null && item.id > 0);
                }
                return undefined;
            };
            // Build deal object with only specified fields
            const deal = {
                id: row.id,
                created_at: new Date(), // Required field
                monthly_price: parseNumber(dealData.monthly_price),
                deposit: parseNumber(dealData.deposit),
                lease_period: parseNumber(dealData.lease_period),
                dealership_car_id: dealData.dealership_car_id || "",
                dealership_id: dealData.dealership_id || "",
                inclusion: parseInclusionArray(inclusionData) || ((_a = parseArray(dealData.inclusion)) === null || _a === void 0 ? void 0 : _a.map((id) => ({ id }))) || undefined,
                mileage: parseNumber(dealData.mileage),
                yearly_mileage: parseNumber(dealData.yearly_mileage),
                sale_status: dealData.sale_status,
            };
            // Parse car fields from JSONB if car data exists
            // Only get id, make, model, and model_variant
            if (carData && typeof carData === "object" && Object.keys(carData).length > 0 && row.car_id) {
                // Parse make from joined table if available, otherwise fallback to carData
                let make;
                if (makeData && typeof makeData === "object" && row.make_id) {
                    const makeName = makeData.name;
                    if (makeName) {
                        make = makeName;
                    }
                }
                else {
                    // Fallback to carData.make if make table join didn't return data
                    const carMake = carData.make;
                    if (carMake) {
                        // If carMake is an object with name, use the name
                        if (typeof carMake === "object" && carMake.name) {
                            make = carMake.name;
                        }
                        else if (typeof carMake === "string") {
                            // If carMake is already a string, use it directly
                            make = carMake;
                        }
                    }
                }
                // Parse model from joined table if available, otherwise fallback to carData
                let model;
                if (modelData && typeof modelData === "object" && row.model_id) {
                    const modelName = modelData.name;
                    if (modelName) {
                        model = modelName;
                    }
                }
                else {
                    // Fallback to carData.model if model table join didn't return data
                    const carModel = carData.model;
                    if (carModel) {
                        // If carModel is an object with name, use the name
                        if (typeof carModel === "object" && carModel.name) {
                            model = carModel.name;
                        }
                        else if (typeof carModel === "string") {
                            // If carModel is already a string, use it directly
                            model = carModel;
                        }
                    }
                }
                // Parse registration_date from car data
                // Handle Unix timestamps (milliseconds or seconds) or date strings
                const parseDate = (value) => {
                    if (!value)
                        return undefined;
                    if (value instanceof Date)
                        return value;
                    if (typeof value === "number") {
                        // Assume milliseconds if > 1000000000000, else seconds
                        return new Date(value > 1000000000000 ? value : value * 1000);
                    }
                    if (typeof value === "string") {
                        // Try parsing as Unix timestamp first
                        const num = Number(value);
                        if (!isNaN(num)) {
                            // Assume milliseconds if > 1000000000000, else seconds
                            return new Date(num > 1000000000000 ? num : num * 1000);
                        }
                        // Otherwise parse as date string
                        const date = new Date(value);
                        return isNaN(date.getTime()) ? undefined : date;
                    }
                    return undefined;
                };
                // Parse additional car fields for match scoring
                const parseNumber = (value) => {
                    if (value === null || value === undefined)
                        return undefined;
                    const num = Number(value);
                    return isNaN(num) ? undefined : num;
                };
                // Build car object with all fields needed for match scoring
                deal.car = {
                    id: row.car_id,
                    created_at: new Date(),
                    dealership_id: carData.dealership_id || deal.dealership_id,
                    make: make,
                    make_id: parseNumber(row.make_id) || parseNumber((_b = carData.make) === null || _b === void 0 ? void 0 : _b.id),
                    model: model,
                    model_id: parseNumber(row.model_id) || parseNumber((_c = carData.model) === null || _c === void 0 ? void 0 : _c.id),
                    model_variant: carData.model_variant,
                    registration_date: parseDate(carData.registration_date),
                    media: carData.media,
                    sale_status: carData.sale_status,
                    fuel: carData.fuel,
                    transmission: carData.transmission,
                    color: typeof carData.color === "number" ? String(carData.color) : carData.color,
                    body: typeof carData.body === "number" ? String(carData.body) : carData.body,
                    tax_class: carData.tax_class,
                    mileage: parseNumber(carData.mileage),
                    weight: parseNumber(carData.weight),
                    horsepower: parseNumber(carData.horsepower),
                    batterycap: parseNumber(carData.batterycap),
                    spec: carData.spec,
                };
            }
            // Always include distance when location filter is provided (even if null)
            if (hasLocationFilter) {
                // Distance is always calculated when location filter is provided
                // It will be NULL if dealership doesn't have a valid geopoint
                const distance = row.distance;
                if (distance !== null && distance !== undefined && !isNaN(Number(distance))) {
                    deal.distance = Number(Number(distance).toFixed(2));
                }
                else {
                    // Include null distance when location filter is provided
                    deal.distance = null;
                }
            }
            // Always include city from municipality (can be null) by default
            const city = row.city;
            if (city !== null && city !== undefined && typeof city === "string") {
                deal.city = city;
            }
            else {
                // Include null city by default
                deal.city = null;
            }
            // Always include region from country (can be null) by default
            const region = row.region;
            if (region !== null && region !== undefined && typeof region === "string") {
                deal.region = region;
            }
            else {
                // Include null region by default
                deal.region = null;
            }
            // Always include request_count from x1_39 table
            const requestCount = row.request_count;
            if (requestCount !== null && requestCount !== undefined) {
                deal.request_count = Number(requestCount) || 0;
            }
            else {
                deal.request_count = 0;
            }
            return deal;
        });
        // Get favorited deal IDs if consumer_id is provided
        let favoritedDealIdsSet = new Set();
        if (consumerId && deals.length > 0) {
            const dealIds = deals.map((deal) => deal.id);
            favoritedDealIdsSet = await (0, auth_1.getFavoritedDealIds)(consumerId, dealIds);
        }
        // Add favourite field to each deal
        const dealsWithFavourites = deals.map((deal) => (Object.assign(Object.assign({}, deal), { favourite: consumerId ? favoritedDealIdsSet.has(deal.id) : false })));
        return {
            items: dealsWithFavourites,
            curPage: page,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
            total,
            perPage,
            totalPages,
        };
    }
};
exports.getDeals = getDeals;
//# sourceMappingURL=deals.js.map