/**
 * Deal Formatting Helpers
 * Functions to format and enrich deal data from database queries
 */

import {executeQuery} from "./pg.js";
import {DealWithCarDetails, CarMedia} from "./schema.js";
import {getFavoritedDealIds} from "./auth.js";

/**
 * Helper function to fetch and format deal details from deal IDs
 * This is used by both new session and existing session paths to avoid code duplication
 * @param dealIds - Array of deal IDs to fetch
 * @param consumerId - Optional consumer ID for favorite checking
 * @returns Promise with deals array including favorite field
 */
export async function fetchAndFormatDeals(
  dealIds: string[],
  consumerId: string | null = null,
): Promise<Array<DealWithCarDetails & {favourite: boolean}>> {
  if (dealIds.length === 0) {
    return [];
  }

  // Query to fetch only required fields from deals and car tables (optimized)
  // Keep all joins for inclusion_data, city, region, request_count, make, model
  const dealDetailsQuery = `
    SELECT 
      d.id,
      -- Deal fields (extracted from JSONB)
      (d.xdo->>'monthly_price')::bigint as monthly_price,
      (d.xdo->>'deposit')::bigint as deposit,
      (d.xdo->>'lease_period')::bigint as lease_period,
      (d.xdo->>'mileage')::bigint as mileage,
      (d.xdo->>'yearly_mileage')::bigint as yearly_mileage,
      d.xdo->'inclusion' as inclusion,
      d.xdo->>'dealership_car_id' as dealership_car_id,
      d.xdo->>'dealership_id' as dealership_id,
      d.xdo->>'status' as status,
      d.xdo->>'sale_status' as sale_status,
      -- Car fields (extracted from JSONB)
      dc.id as car_id,
      dc.xdo->'make' as car_make,
      dc.xdo->'model' as car_model,
      dc.xdo->>'model_variant' as model_variant,
      dc.xdo->'spec' as car_spec,
      dc.xdo->>'image' as car_image,
      dc.xdo->'media' as car_media,
      dc.xdo->>'sale_status' as car_sale_status,
      -- Make and model data (from joined tables)
      make.id as make_id,
      make.xdo as make_data,
      model.id as model_id,
      model.xdo as model_data,
      -- Inclusion data (from joined table)
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
      ) as inclusion_data,
      -- City (from joined municipality table)
      (
        SELECT muni.xdo->>'name'
        FROM public.mvpw1_62 muni
        WHERE (
          -- If municipality is stored as a number, extract it directly
          (jsonb_typeof(dl_loc.xdo->'location'->'muncipality') = 'number' 
           AND (dl_loc.xdo->'location'->'muncipality')::integer IS NOT NULL
           AND muni.id = (dl_loc.xdo->'location'->'muncipality')::integer)
          OR
          -- If municipality is stored as a string, validate and convert
          (jsonb_typeof(dl_loc.xdo->'location'->'muncipality') = 'string'
           AND dl_loc.xdo->'location'->>'muncipality' IS NOT NULL
           AND dl_loc.xdo->'location'->>'muncipality' != ''
           AND (dl_loc.xdo->'location'->>'muncipality') ~ '^[0-9]+$'
           AND muni.id = (dl_loc.xdo->'location'->>'muncipality')::integer)
        )
        LIMIT 1
      ) as city,
      -- Region (from joined country table)
      (
        SELECT country.xdo->>'name'
        FROM public.mvpw1_63 country
        WHERE (
          -- If country is stored as a number, extract it directly
          (jsonb_typeof(dl_loc.xdo->'location'->'country') = 'number' 
           AND (dl_loc.xdo->'location'->'country')::integer IS NOT NULL
           AND country.id = (dl_loc.xdo->'location'->'country')::integer)
          OR
          -- If country is stored as a string, validate and convert
          (jsonb_typeof(dl_loc.xdo->'location'->'country') = 'string'
           AND dl_loc.xdo->'location'->>'country' IS NOT NULL
           AND dl_loc.xdo->'location'->>'country' != ''
           AND (dl_loc.xdo->'location'->>'country') ~ '^[0-9]+$'
           AND country.id = (dl_loc.xdo->'location'->>'country')::integer)
        )
        LIMIT 1
      ) as region,
      -- Request count (from joined table)
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
    LEFT JOIN public.mvpw1_6 dl_loc ON (d.xdo->>'dealership_id')::uuid = dl_loc.id
    WHERE d.id = ANY($1::uuid[])
    AND d.xdo->>'status' = 'active'
  `;

  const dealDetailsResult = await executeQuery(dealDetailsQuery, [dealIds]);

  // Helper parsing functions
  const parseNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined) return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  };

  const parseArray = (value: unknown): number[] | undefined => {
    if (!value) return undefined;
    if (Array.isArray(value)) {
      return value.map((v) => parseNumber(v)).filter((v) => v !== undefined) as number[];
    }
    return undefined;
  };

  const parseInclusionArray = (value: unknown): Array<{ id: number;[key: string]: unknown }> | undefined => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
      if (value.length === 0) return [];
      return value
        .map((item) => {
          if (item && typeof item === "object" && "id" in item) {
            const inclusionItem: { id: number;[key: string]: unknown } = {
              id: parseNumber(item.id) || 0,
            };
            if ("data" in item && item.data && typeof item.data === "object") {
              Object.assign(inclusionItem, item.data);
            }
            return inclusionItem;
          }
          return null;
        })
        .filter((item) => item !== null && item.id > 0) as Array<{ id: number;[key: string]: unknown }>;
    }
    return undefined;
  };

  // Map deals to match the order in dealIds
  const dealMap = new Map<string, typeof dealDetailsResult.rows[0]>();
  dealDetailsResult.rows.forEach((row) => {
    dealMap.set(row.id as string, row);
  });

  // Check for favorites if consumerId is available
  let favoritedDealIds = new Set<string>();
  if (consumerId && dealIds.length > 0) {
    favoritedDealIds = await getFavoritedDealIds(consumerId, dealIds);
  }

  const fullDeals: DealWithCarDetails[] = dealIds
    .filter((dealId) => dealMap.has(dealId)) // Skip deals no longer active or missing from DB
    .map((dealId) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by .filter(dealMap.has) above
      const row = dealMap.get(dealId)!;

      // Extract deal fields directly from row
      const monthlyPrice = row.monthly_price !== null && row.monthly_price !== undefined ? Number(row.monthly_price) : 0;
      const deposit = row.deposit !== null && row.deposit !== undefined ? Number(row.deposit) : 0;
      const leasePeriod = row.lease_period !== null && row.lease_period !== undefined ? Number(row.lease_period) : 0;
      const mileage = row.mileage !== null && row.mileage !== undefined ? Number(row.mileage) : 0;
      const yearlyMileage = (row as Record<string, unknown>).yearly_mileage !== null && (row as Record<string, unknown>).yearly_mileage !== undefined ? Number((row as Record<string, unknown>).yearly_mileage) : 0;
      const dealershipCarId = (row.dealership_car_id as string | null) || "";
      const dealershipId = (row.dealership_id as string | null) || "";
      const status = (row.status as string | null) || "active";
      const saleStatus = (row.sale_status as string | null) || undefined;

      // Parse inclusion array
      const inclusionData = (row.inclusion_data as Array<{ id: number; data: Record<string, unknown> }> | null) || null;
      const inclusionValue = (row.inclusion as unknown) || null;
      const inclusion = parseInclusionArray(inclusionData) || parseArray(inclusionValue)?.map((id) => ({id})) || undefined;

      // Extract car fields directly from row
      const carId = row.car_id as string | null;
      const carMake = row.car_make as { id?: number; name?: string } | null;
      const carModel = row.car_model as { id?: number; name?: string } | null;
      const modelVariant = row.model_variant as string | null | undefined;
      const carSpec = row.car_spec as number[] | null | undefined;
      const carImage = row.car_image as string | null | undefined;
      const carMedia = row.car_media as CarMedia | null | undefined;
      const carSaleStatus = row.car_sale_status as string | null | undefined;

      // Get make and model data from joined tables
      const makeData = (row.make_data as Record<string, unknown> | null) || null;
      const modelData = (row.model_data as Record<string, unknown> | null) || null;

      // Get make name (prefer from joined table, fallback to car data)
      let make: string | undefined;
      if (makeData && typeof makeData === "object" && row.make_id) {
        make = makeData.name as string | undefined;
      } else if (carMake) {
        if (typeof carMake === "object" && carMake.name) {
          make = carMake.name;
        } else if (typeof carMake === "string") {
          make = carMake;
        }
      }

      // Get model name (prefer from joined table, fallback to car data)
      let model: string | undefined;
      if (modelData && typeof modelData === "object" && row.model_id) {
        model = modelData.name as string | undefined;
      } else if (carModel) {
        if (typeof carModel === "object" && carModel.name) {
          model = carModel.name;
        } else if (typeof carModel === "string") {
          model = carModel;
        }
      }

      const deal: DealWithCarDetails = {
        id: row.id as string,
        created_at: new Date(),
        monthly_price: monthlyPrice,
        deposit: deposit,
        lease_period: leasePeriod,
        mileage: mileage,
        yearly_mileage: yearlyMileage,
        dealership_car_id: dealershipCarId,
        dealership_id: dealershipId,
        status: status,
        sale_status: saleStatus,
        inclusion: inclusion,
        request_count: (row.request_count !== null && row.request_count !== undefined) ? Number(row.request_count) || 0 : 0,
      };

      // Add car details if car_id is available
      if (carId) {
        deal.car = {
          id: carId,
          created_at: new Date(),
          dealership_id: dealershipId || "",
          make: make,
          model: model,
          ...(row.make_id ? {make_id: row.make_id as number} : {}),
          ...(row.model_id ? {model_id: row.model_id as number} : {}),
          model_variant: modelVariant || undefined,
          spec: carSpec || undefined,
          image: carImage || undefined,
          media: carMedia || undefined,
          sale_status: carSaleStatus || undefined,
        };
      }

      // Always include city from municipality (can be null) - matching getDeals behavior
      const city = (row as Record<string, unknown>).city;
      if (city !== null && city !== undefined && typeof city === "string") {
        deal.city = city;
      } else {
        deal.city = null;
      }

      // Always include region from country (can be null) - matching getDeals behavior
      const region = (row as Record<string, unknown>).region;
      if (region !== null && region !== undefined && typeof region === "string") {
        deal.region = region;
      } else {
        deal.region = null;
      }

      return deal;
    });

  // Add favourite field to each deal
  return fullDeals.map((deal) => ({
    ...deal,
    favourite: consumerId ? favoritedDealIds.has(deal.id) : false,
  }));
}
