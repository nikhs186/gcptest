import * as logger from "firebase-functions/logger";
import {DealWithCarDetails} from "./schema";
import {executeQuery} from "./pg";

/**
 * Consumer Profile Interface matching x1_14 table structure
 */
export interface ConsumerProfile {
  id: string;
  created_at: number;
  local_dealership: boolean;
  name: string;
  make: { make: number; priority: number }[];
  model: { model: number; priority: number }[];
  city: { city: number; priority: number }[];
  inclusion: { inclusion: number; priority: number }[];
  specs: { specs: number; priority: number }[];
  color: { color: number; priority: number }[];
  body: { body: number; priority: number }[];
  fuel: { priority: number; fuel: "petrol" | "diesel" | "gas" | "electric" | "hybrid-petrol" | "hybrid-diesel" }[];
  transmission: { priority: number; transmission: "manual" | "automatic" }[];
  seat: { priority: number; seat: number }[];
  tax_class: { priority: number; tax_class: "passenger" | "van" }[];
  battery_range: { min: number; max: number | null; priority: number }[];
  monthly_price: { min: number; max: number | null; priority: number };
  deposit: { min: number; max: number | null; priority: number; isZero?: boolean };
  lease_period: { min: number; max: number | null; priority: number };
  mileage: { min: number; max: number | null; priority: number };
  location: {
    zipcode: string;
    geopoint: { type: string; data: { lng: number; lat: number } };
  };
  consumer_id: string;
  data: Record<string, unknown>;
  // Additional fields that might exist
  weight?: { min: number; max: number | null; priority: number }[];
  horsepower?: { min: number; max: number | null; priority: number }[];
  batterycap?: { min: number; max: number | null; priority: number }[];
  wheel_drive?: { priority: number; wheel_drive: number }[];
}

/**
 * Normalizes profile data from database to ensure consistent structure
 * Handles cases where JSONB fields might be strings or already parsed objects
 */
export function normalizeProfileData(row: Record<string, unknown>): ConsumerProfile {
  const parseJsonbField = <T>(value: unknown, defaultValue: T): T => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    }
    return value as T;
  };

  const parseJsonbArray = <T>(value: unknown, defaultValue: T[]): T[] => {
    const parsed = parseJsonbField<unknown>(value, defaultValue as unknown);
    return Array.isArray(parsed) ? (parsed as T[]) : defaultValue;
  };

  const parseJsonbObject = <T extends Record<string, unknown>>(
    value: unknown,
    defaultValue: T
  ): T => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      return value as T;
    }
    return defaultValue;
  };

  const parseRangeObject = (
    value: unknown,
    defaultValue: {min: number; max: number | null; priority: number}
  ) => {
    const parsed = parseJsonbField<unknown>(value, defaultValue as unknown);
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return first as {min: number; max: number | null; priority: number};
      }
      return defaultValue;
    }
    return parseJsonbObject(parsed, defaultValue);
  };

  return {
    id: String(row.id || ""),
    created_at: Number(row.created_at || 0),
    local_dealership: Boolean(row.local_dealership || false),
    name: String(row.name || ""),
    make: parseJsonbArray(row.make, []),
    model: parseJsonbArray(row.model, []),
    city: parseJsonbArray(row.city, []),
    inclusion: parseJsonbArray(row.inclusion, []),
    specs: parseJsonbArray(row.specs, []),
    color: parseJsonbArray(row.color, []),
    body: parseJsonbArray(row.body, []),
    fuel: parseJsonbArray(row.fuel, []),
    transmission: parseJsonbArray(row.transmission, []),
    seat: parseJsonbArray(row.seat, []),
    tax_class: parseJsonbArray(row.tax_class, []),
    battery_range: parseJsonbArray(row.battery_range, []),
    monthly_price: parseRangeObject(row.monthly_price, {min: 0, max: null, priority: 999}),
    deposit: parseRangeObject(row.deposit, {min: 0, max: null, priority: 999}),
    lease_period: parseRangeObject(row.lease_period, {min: 0, max: null, priority: 999}),
    mileage: parseRangeObject(row.mileage, {min: 0, max: null, priority: 999}),
    location: parseJsonbObject(row.location, {
      zipcode: "",
      geopoint: {type: "Point", data: {lng: 0, lat: 0}},
    }),
    consumer_id: String(row.consumer_id || ""),
    data: parseJsonbObject(row.data, {}),
    weight: row.weight ? parseJsonbArray(row.weight, []) : undefined,
    horsepower: row.horsepower ? parseJsonbArray(row.horsepower, []) : undefined,
    batterycap: row.batterycap ? parseJsonbArray(row.batterycap, []) : undefined,
    wheel_drive: row.wheel_drive ? parseJsonbArray(row.wheel_drive, []) : undefined,
  };
}

/**
 * Field categories for priority grouping
 */
enum PriorityLevel {
  HIGHEST = "highest",
  SECOND = "second",
  THIRD = "third",
}

/**
 * Field configuration for match scoring
 */
interface FieldConfig {
  name: string;
  defaultPriority: PriorityLevel;
  weight: number; // Base weight for this priority level
}

/**
 * Match Score Result
 */
export interface MatchScoreResult {
  score: number; // 0-100
  breakdown: {
    field: string;
    matched: boolean;
    score: number;
    priority: PriorityLevel;
    details?: string;
  }[];
  missingData: string[]; // Fields that are missing in deal/car data
}

/**
 * Field configurations with default priorities
 */
const FIELD_CONFIGS: FieldConfig[] = [
  // Highest priority fields
  {name: "monthly_price", defaultPriority: PriorityLevel.HIGHEST, weight: 10},
  {name: "deposit", defaultPriority: PriorityLevel.HIGHEST, weight: 10},
  {name: "mileage", defaultPriority: PriorityLevel.HIGHEST, weight: 10}, // Deal mileage
  {name: "lease_period", defaultPriority: PriorityLevel.HIGHEST, weight: 10},
  // Second priority fields
  {name: "make", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "model", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "fuel", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "wheel_drive", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "transmission", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "color", defaultPriority: PriorityLevel.SECOND, weight: 7},
  {name: "body", defaultPriority: PriorityLevel.SECOND, weight: 7},
  // Third priority fields
  {name: "tax_class", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "weight", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "horsepower", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "batterycap", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "battery_range", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "specs", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
  {name: "inclusion", defaultPriority: PriorityLevel.THIRD, weight: 3.5},
];

// Explicit business weights (total = 100)
const MATCH_CATEGORY_WEIGHTS = {
  // Economic bucket (45 total): 50% monthly_price, 25% deposit, 15% lease_period, 10% mileage
  monthly_price: 22.5,
  deposit: 11.25,
  mileage: 4.5, // yearly_mileage from deal
  lease_period: 6.75,
  body: 20,
  fuel: 15,
  make: 10,
  wheel_drive: 5,
  model: 1,
  transmission: 1,
  color: 1,
  tax_class: 1,
  weight: 1,
  horsepower: 1,
  batterycap: 1,
  battery_range: 1,
  specs: 1,
  inclusion: 1,
} as const;

/**
 * Determines the effective priority level for a field based on profile data
 * If a lower priority field has priority = 1, it shifts to highest priority
 */
function getEffectivePriority(
  fieldName: string,
  profile: ConsumerProfile,
): PriorityLevel {
  const fieldConfig = FIELD_CONFIGS.find((f) => f.name === fieldName);
  if (!fieldConfig) {
    return PriorityLevel.THIRD; // Default to lowest priority
  }

  // Check if this field has priority = 1 in profile (indicating highest importance)
  let hasPriorityOne = false;

  switch (fieldName) {
  case "monthly_price":
    hasPriorityOne = profile.monthly_price?.priority === 1;
    break;
  case "deposit":
    hasPriorityOne = profile.deposit?.priority === 1;
    break;
  case "mileage":
    hasPriorityOne = profile.mileage?.priority === 1;
    break;
  case "lease_period":
    hasPriorityOne = profile.lease_period?.priority === 1;
    break;
  case "make":
    hasPriorityOne = profile.make?.some((m) => m.priority === 1) || false;
    break;
  case "model":
    hasPriorityOne = profile.model?.some((m) => m.priority === 1) || false;
    break;
  case "fuel":
    hasPriorityOne = profile.fuel?.some((f) => f.priority === 1) || false;
    break;
  case "wheel_drive":
    hasPriorityOne = profile.wheel_drive?.some((w) => w.priority === 1) || false;
    break;
  case "transmission":
    hasPriorityOne = profile.transmission?.some((t) => t.priority === 1) || false;
    break;
  case "color":
    hasPriorityOne = profile.color?.some((c) => c.priority === 1) || false;
    break;
  case "body":
    hasPriorityOne = profile.body?.some((b) => b.priority === 1) || false;
    break;
  case "tax_class":
    hasPriorityOne = profile.tax_class?.some((t) => t.priority === 1) || false;
    break;
  case "weight":
    hasPriorityOne = profile.weight?.some((w) => w.priority === 1) || false;
    break;
  case "horsepower":
    hasPriorityOne = profile.horsepower?.some((h) => h.priority === 1) || false;
    break;
  case "batterycap":
    hasPriorityOne = profile.batterycap?.some((b) => b.priority === 1) || false;
    break;
  case "battery_range":
    hasPriorityOne = profile.battery_range?.some((b) => b.priority === 1) || false;
    break;
  case "specs":
    hasPriorityOne = profile.specs?.some((s) => s.priority === 1) || false;
    break;
  case "inclusion":
    hasPriorityOne = profile.inclusion?.some((i) => i.priority === 1) || false;
    break;
  }

  // If priority = 1, shift to highest priority
  if (hasPriorityOne) {
    return PriorityLevel.HIGHEST;
  }

  return fieldConfig.defaultPriority;
}

/**
 * Checks if a value falls within a min/max range
 * Special cases:
 * - If min=0 and max=1000: value should be <= 1000
 * - If max=0 and min != 0: value should be >= min (e.g., [10000, 0] means >= 10000)
 * - If max=null or undefined: value should be >= min
 */
function isInRange(value: number, min: number, max: number | null | undefined): boolean {
  // Special case: min=0, max=1000 means value should be <= 1000
  if (min === 0 && max === 1000) {
    return value <= 1000;
  }

  // Special case: max=0 and min != 0 means value should be >= min
  // Examples: [10000, 0] means >= 10000, [1000, 0] means >= 1000
  if (max === 0 && min !== 0) {
    return value >= min;
  }

  // If max is null or undefined, value should be >= min
  if (max === null || max === undefined) {
    return value >= min;
  }

  // Normal range check: value should be between min and max
  return value >= min && value <= max;
}

/**
 * Calculates match score for a range-based field (monthly_price, deposit, etc.)
 * Handles special cases:
 * - min=0, max=1000: value <= 1000
 * - max=0 and min != 0: value >= min (e.g., [10000, 0] means >= 10000)
 */
function calculateRangeMatch(
  dealValue: number | undefined,
  profileRange: { min: number; max: number | null; priority: number } | undefined,
): { matched: boolean; score: number; details: string } {
  if (dealValue === undefined || !profileRange) {
    return {
      matched: false,
      score: 0,
      details: dealValue === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  // Treat [0, 0] range as invalid/missing (empty range)
  if (profileRange.min === 0 && profileRange.max === 0) {
    return {
      matched: false,
      score: 0,
      details: "Invalid range [0, 0] in profile - treated as missing",
    };
  }

  const matched = isInRange(dealValue, profileRange.min, profileRange.max);

  // Build details string based on special cases
  let details: string;
  if (profileRange.min === 0 && profileRange.max === 1000) {
    details = matched ?
      `Value ${dealValue} <= 1000 (special case: min=0, max=1000)` :
      `Value ${dealValue} > 1000 (special case: min=0, max=1000)`;
  } else if (profileRange.max === 0 && profileRange.min !== 0) {
    // Special case: max=0 means value should be >= min (e.g., [10000, 0] means >= 10000)
    details = matched ?
      `Value ${dealValue} >= ${profileRange.min} (special case: max=0 means >= min)` :
      `Value ${dealValue} < ${profileRange.min} (special case: max=0 means >= min)`;
  } else if (profileRange.max === null || profileRange.max === undefined) {
    details = matched ?
      `Value ${dealValue} >= ${profileRange.min} (unlimited max)` :
      `Value ${dealValue} < ${profileRange.min} (unlimited max)`;
  } else {
    details = matched ?
      `Value ${dealValue} within range [${profileRange.min}, ${profileRange.max}]` :
      `Value ${dealValue} outside range [${profileRange.min}, ${profileRange.max}]`;
  }

  return {
    matched,
    score: matched ? 100 : 0,
    details,
  };
}

/**
 * Calculates match score for price-based fields (monthly_price, deposit) where lower values get slightly higher scores
 * If value is within range, lower prices get a small bonus (2-3 points max difference)
 */
function calculatePriceRangeMatch(
  dealValue: number | undefined,
  profileRange: { min: number; max: number | null; priority: number } | undefined,
): { matched: boolean; score: number; details: string } {
  if (dealValue === undefined || !profileRange) {
    return {
      matched: false,
      score: 0,
      details: dealValue === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  // Treat [0, 0] range as invalid/missing (empty range)
  if (profileRange.min === 0 && profileRange.max === 0) {
    return {
      matched: false,
      score: 0,
      details: "Invalid range [0, 0] in profile - treated as missing",
    };
  }

  const matched = isInRange(dealValue, profileRange.min, profileRange.max);

  if (!matched) {
    return {
      matched: false,
      score: 0,
      details: `Value ${dealValue} outside range [${profileRange.min}, ${profileRange.max ?? "unlimited"}]`,
    };
  }

  // Calculate score with bonus for lower values
  // Bonus range: 5 points (so min value gets 100, max value gets 95)
  // This ensures at least 1-2 points difference in final integer match score
  const BONUS_RANGE = 5;
  let score = 100;
  let details: string;

  // Handle special cases
  if (profileRange.min === 0 && profileRange.max === 1000) {
    // Special case: min=0, max=1000 means value should be <= 1000
    // Lower values get slightly higher scores
    // Normalize: value / 1000 (0 to 1, where 0 is best)
    const normalizedPosition = Math.min(1, dealValue / 1000);
    score = 100 - (normalizedPosition * BONUS_RANGE);
    details = `Value ${dealValue} <= 1000 (lower is better, score: ${score.toFixed(1)})`;
  } else if (profileRange.max === 0 && profileRange.min !== 0) {
    // Special case: max=0 means value should be >= min (e.g., [10000, 0] means >= 10000)
    // For this case, we can't really apply "lower is better" since there's no upper bound
    // So just return 100 if matched
    score = 100;
    details = `Value ${dealValue} >= ${profileRange.min} (special case: max=0 means >= min)`;
  } else if (profileRange.max === null || profileRange.max === undefined) {
    // Unlimited max: value should be >= min
    score = 100;
    details = `Value ${dealValue} >= ${profileRange.min} (unlimited max)`;
  } else {
    // Normal range: calculate normalized position within range
    // Lower values (closer to min) get higher scores
    const rangeSize = (profileRange.max ?? dealValue) - profileRange.min;
    if (rangeSize > 0) {
      const normalizedPosition = (dealValue - profileRange.min) / rangeSize;
      score = 100 - (normalizedPosition * BONUS_RANGE);
    } else {
      // Range size is 0 or negative, just return 100
      score = 100;
    }
    details = `Value ${dealValue} within range [${profileRange.min}, ${profileRange.max ?? "unlimited"}] (lower is better, score: ${score.toFixed(1)})`;
  }

  // Ensure score is between 95 and 100 (capped to allow for bonus range)
  score = Math.max(95, Math.min(100, score));

  return {
    matched: true,
    score: Math.round(score * 100) / 100, // Round to 2 decimal places
    details,
  };
}

/**
 * Calculates match score for mileage field where "higher is better"
 * If deal value >= profile min, it's a match (even if it exceeds max)
 * Example: Profile [0, 16000], Deal 50000 → Match (higher is better)
 */
function calculateMileageMatch(
  dealValue: number | undefined,
  profileRange: { min: number; max: number | null; priority: number } | undefined,
): { matched: boolean; score: number; details: string } {
  if (dealValue === undefined || !profileRange) {
    return {
      matched: false,
      score: 0,
      details: dealValue === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  // Treat [0, 0] range as invalid/missing (empty range)
  if (profileRange.min === 0 && profileRange.max === 0) {
    return {
      matched: false,
      score: 0,
      details: "Invalid range [0, 0] in profile - treated as missing",
    };
  }

  // For mileage: if deal value >= profile min, it's a match (higher is better)
  const matched = dealValue >= profileRange.min;

  let details: string;
  if (matched) {
    if (profileRange.max !== null && profileRange.max !== undefined && dealValue > profileRange.max) {
      details = `Value ${dealValue} exceeds range [${profileRange.min}, ${profileRange.max}] - higher is better, so matched`;
    } else {
      details = `Value ${dealValue} within or exceeds range [${profileRange.min}, ${profileRange.max ?? "unlimited"}]`;
    }
  } else {
    details = `Value ${dealValue} below minimum ${profileRange.min}`;
  }

  return {
    matched,
    score: matched ? 100 : 0,
    details,
  };
}

/**
 * Calculates match score for array-based fields (make, model, fuel, etc.)
 */
function calculateArrayMatch<T>(
  dealValue: T | T[] | undefined,
  profileArray: Array<{ priority: number;[key: string]: unknown }> | undefined,
  valueKey: string,
  getDealValue: (item: T) => unknown,
): { matched: boolean; score: number; details: string } {
  if (!dealValue || !profileArray || profileArray.length === 0) {
    return {
      matched: false,
      score: 0,
      details: dealValue === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  const dealValues = Array.isArray(dealValue) ? dealValue : [dealValue];
  // Normalize deal values using the provided getDealValue function
  const normalizedDealValues = dealValues.map(getDealValue);

  // Check if any profile value matches - if any match, score is 100%
  const matchedItems: string[] = [];

  for (const profileItem of profileArray) {
    const profileValue = profileItem[valueKey];

    // Check if profile value matches any deal value (handling type conversion)
    let isMatch = false;
    for (const dealVal of normalizedDealValues) {
      // Try numeric comparison first
      const profileNum = Number(profileValue);
      const dealNum = Number(dealVal);
      if (!isNaN(profileNum) && !isNaN(dealNum) && profileNum === dealNum) {
        isMatch = true;
        break;
      }
      // Fallback to string comparison
      if (String(profileValue) === String(dealVal)) {
        isMatch = true;
        break;
      }
    }

    if (isMatch) {
      matchedItems.push(String(profileValue));
    }
  }

  const matched = matchedItems.length > 0;
  const score = matched ? 100 : 0;

  return {
    matched,
    score,
    details: matched ?
      `Matched: ${matchedItems.join(", ")} (score: 100%)` :
      "No matches found",
  };
}

/**
 * Fetches color name from x1_35 table by color ID
 * @param {number} colorId Color ID from profile
 * @return {Promise<string | null>} Color name or null if not found
 */
async function getColorValue(
  colorId: number,
  cache?: Map<number, string | null>
): Promise<string | null> {
  // Check cache first
  if (cache && cache.has(colorId)) {
    return cache.get(colorId) ?? null;
  }

  try {
    const query = `
      SELECT name
      FROM public.x1_35
      WHERE id = $1
      LIMIT 1
    `;
    const result = await executeQuery(query, [colorId]);
    const name = result.rows.length > 0 ? (result.rows[0].name as string | null) : null;

    // Store in cache if provided
    if (cache) {
      cache.set(colorId, name);
    }

    return name;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching color name from x1_35", {error: errorMessage, colorId});
    const nullValue = null;
    if (cache) {
      cache.set(colorId, nullValue);
    }
    return nullValue;
  }
}

/**
 * Fetches body code from x1_64 table by body ID
 * @param {number} bodyId Body ID from profile
 * @return {Promise<string | null>} Body code or null if not found
 */
async function getBodyCode(
  bodyId: number,
  cache?: Map<number, string | null>
): Promise<string | null> {
  // Check cache first
  if (cache && cache.has(bodyId)) {
    return cache.get(bodyId) ?? null;
  }

  try {
    const query = `
      SELECT code
      FROM public.x1_64
      WHERE id = $1
      LIMIT 1
    `;
    const result = await executeQuery(query, [bodyId]);
    const code = result.rows.length > 0 ? (result.rows[0].code as string | null) : null;

    // Store in cache if provided
    if (cache) {
      cache.set(bodyId, code);
    }

    return code;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching body code from x1_64", {error: errorMessage, bodyId});
    const nullValue = null;
    if (cache) {
      cache.set(bodyId, nullValue);
    }
    return nullValue;
  }
}

/**
 * Calculates match score for color field with database lookup
 * Profile has color IDs (numbers), need to lookup actual color names from x1_35
 */
async function calculateColorMatch(
  dealColor: string | number | undefined,
  profileColors: Array<{ color: number; priority: number }> | undefined,
  colorCache?: Map<number, string | null>,
): Promise<{ matched: boolean; score: number; details: string }> {
  if (!dealColor || !profileColors || profileColors.length === 0) {
    return {
      matched: false,
      score: 0,
      details: dealColor === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  // Normalize deal color to string for comparison
  const dealColorStr = String(dealColor).toLowerCase().trim();

  // Get color names from cache (already pre-fetched, so this is instant)
  const colorNames: (string | null)[] = [];
  if (colorCache) {
    // All values are already in cache, just retrieve them synchronously
    for (const pc of profileColors) {
      colorNames.push(colorCache.get(pc.color) ?? null);
    }
  } else {
    // Fallback: fetch from database if cache not provided
    const colorNamePromises = profileColors.map((pc) => getColorValue(pc.color, colorCache));
    const fetchedNames = await Promise.all(colorNamePromises);
    colorNames.push(...fetchedNames);
  }

  // Check if any color matches - if any match, score is 100%
  const matchedItems: string[] = [];

  for (let i = 0; i < profileColors.length; i++) {
    const colorName = colorNames[i];
    if (colorName) {
      const normalizedColorName = colorName.toLowerCase().trim();
      if (normalizedColorName === dealColorStr) {
        matchedItems.push(colorName);
      }
    }
  }

  const matched = matchedItems.length > 0;
  const score = matched ? 100 : 0;

  return {
    matched,
    score,
    details: matched ?
      `Matched: ${matchedItems.join(", ")} (score: 100%)` :
      "No matches found",
  };
}

/**
 * Calculates match score for body field with database lookup
 * Profile has body IDs (numbers), need to lookup actual body codes from x1_64
 */
async function calculateBodyMatch(
  dealBody: string | number | undefined,
  profileBodies: Array<{ body: number; priority: number }> | undefined,
  bodyCache?: Map<number, string | null>,
): Promise<{ matched: boolean; score: number; details: string }> {
  if (!dealBody || !profileBodies || profileBodies.length === 0) {
    return {
      matched: false,
      score: 0,
      details: dealBody === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  // Normalize deal body to string for comparison
  const dealBodyStr = String(dealBody).toLowerCase().trim();

  // Get body codes from cache (already pre-fetched, so this is instant)
  const bodyCodes: (string | null)[] = [];
  if (bodyCache) {
    // All values are already in cache, just retrieve them synchronously
    for (const pb of profileBodies) {
      bodyCodes.push(bodyCache.get(pb.body) ?? null);
    }
  } else {
    // Fallback: fetch from database if cache not provided
    const bodyCodePromises = profileBodies.map((pb) => getBodyCode(pb.body, bodyCache));
    const fetchedCodes = await Promise.all(bodyCodePromises);
    bodyCodes.push(...fetchedCodes);
  }

  // Check if any body matches - if any match, score is 100%
  const matchedItems: string[] = [];

  for (let i = 0; i < profileBodies.length; i++) {
    const bodyCode = bodyCodes[i];
    if (bodyCode) {
      const normalizedBodyCode = bodyCode.toLowerCase().trim();
      if (normalizedBodyCode === dealBodyStr) {
        matchedItems.push(bodyCode);
      }
    }
  }

  const matched = matchedItems.length > 0;
  const score = matched ? 100 : 0;

  return {
    matched,
    score,
    details: matched ?
      `Matched: ${matchedItems.join(", ")} (score: 100%)` :
      "No matches found",
  };
}

/**
 * Gets wheel drive code from x1_90 table, using cache if available
 */
async function getWheelDriveCode(
  wheelDriveId: number,
  wheelDriveCache?: Map<number, string | null>,
): Promise<string | null> {
  if (wheelDriveCache) {
    return wheelDriveCache.get(wheelDriveId) ?? null;
  }
  try {
    const {executeQuery} = await import("./pg.js");
    const result = await executeQuery(
      "SELECT code FROM public.x1_90 WHERE id = $1 LIMIT 1",
      [wheelDriveId],
    );
    return result.rows.length > 0 ? (result.rows[0].code as string | null) : null;
  } catch {
    return null;
  }
}

/**
 * Calculates match score for wheel_drive field with database lookup
 * Profile has wheel_drive IDs (numbers), need to lookup actual codes from x1_90
 */
async function calculateWheelDriveMatch(
  dealWheelDrive: string | number | undefined,
  profileWheelDrives: Array<{ wheel_drive: number; priority: number }> | undefined,
  wheelDriveCache?: Map<number, string | null>,
): Promise<{ matched: boolean; score: number; details: string }> {
  if (!dealWheelDrive || !profileWheelDrives || profileWheelDrives.length === 0) {
    return {
      matched: false,
      score: 0,
      details: dealWheelDrive === undefined ? "Missing in deal" : "Missing in profile",
    };
  }

  const dealWheelDriveStr = String(dealWheelDrive).toLowerCase().trim();

  // Get wheel drive codes from cache (already pre-fetched)
  const wheelDriveCodes: (string | null)[] = [];
  if (wheelDriveCache) {
    for (const pw of profileWheelDrives) {
      wheelDriveCodes.push(wheelDriveCache.get(pw.wheel_drive) ?? null);
    }
  } else {
    const promises = profileWheelDrives.map((pw) => getWheelDriveCode(pw.wheel_drive, wheelDriveCache));
    const fetched = await Promise.all(promises);
    wheelDriveCodes.push(...fetched);
  }

  const matchedItems: string[] = [];

  for (let i = 0; i < profileWheelDrives.length; i++) {
    const code = wheelDriveCodes[i];
    if (code) {
      const normalizedCode = code.toLowerCase().trim();
      if (normalizedCode === dealWheelDriveStr) {
        matchedItems.push(code);
      }
    }
  }

  const matched = matchedItems.length > 0;
  const score = matched ? 100 : 0;

  return {
    matched,
    score,
    details: matched ?
      `Matched: ${matchedItems.join(", ")} (score: 100%)` :
      "No matches found",
  };
}

/**
 * Calculates match score for number array fields (specs, inclusion)
 */
function calculateNumberArrayMatch(
  dealArray: number[] | undefined,
  profileArray: Array<{ priority: number;[key: string]: number }> | undefined,
  valueKey: string,
): { matched: boolean; score: number; details: string } {
  if (!dealArray || dealArray.length === 0 || !profileArray || profileArray.length === 0) {
    return {
      matched: false,
      score: 0,
      details: !dealArray || dealArray.length === 0 ? "Missing in deal" : "Missing in profile",
    };
  }

  const dealValueSet = new Set(dealArray);

  let totalScore = 0;
  let maxPossibleScore = 0;
  const matchedItems: number[] = [];

  for (const profileItem of profileArray) {
    const profileValue = profileItem[valueKey];
    const priority = profileItem.priority || 999;
    const weight = Math.max(1, 11 - priority);
    maxPossibleScore += weight;

    if (dealValueSet.has(profileValue)) {
      totalScore += weight;
      matchedItems.push(profileValue);
    }
  }

  const matched = totalScore > 0;
  const score = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

  return {
    matched,
    score,
    details: matched ?
      `Matched: ${matchedItems.join(", ")} (score: ${score.toFixed(1)}%)` :
      "No matches found",
  };
}

/**
 * Main function to calculate match score between a deal and consumer profile
 *
 * Algorithm:
 * 1. Determine effective priority for each field (checking if priority = 1 shifts it to highest)
 * 2. For each field, calculate individual match score (0-100)
 * 3. Calculate weighted score for each field: score × fieldWeight × priorityWeight
 * 4. Sum all weighted scores and divide by sum of max possible weighted scores
 * 5. Multiply by 99 to get final score (0-99 with decimals)
 * 6. If all fields match perfectly, final score = 99
 *
 * @param {DealWithCarDetails} deal The deal to match against
 * @param {ConsumerProfile} profile The consumer profile to match with
 * @return {Promise<MatchScoreResult>} Match score result with breakdown
 */
export async function calculateMatchScore(
  deal: DealWithCarDetails,
  profile: ConsumerProfile,
  colorCache?: Map<number, string | null>,
  bodyCache?: Map<number, string | null>,
  wheelDriveCache?: Map<number, string | null>,
): Promise<MatchScoreResult> {
  // Log input data for debugging specific deal/profile combination
  if (deal.id === "6a05ea3f-9fe9-4140-938a-e8a6ba5368c6" && profile.id === "76b40ea2-b479-4855-bafd-9bd857a16a67") {
    logger.info("Match score calculation input data", {
      dealId: deal.id,
      profileId: profile.id,
      deal_monthly_price: deal.monthly_price,
      deal_deposit: deal.deposit,
      deal_mileage: deal.yearly_mileage,
      deal_lease_period: deal.lease_period,
      deal_inclusion: deal.inclusion?.map((inc) => inc.id),
      deal_car_spec: deal.car?.spec,
      deal_car_fuel: deal.car?.fuel,
      profile_monthly_price: JSON.stringify(profile.monthly_price),
      profile_deposit: JSON.stringify(profile.deposit),
      profile_mileage: JSON.stringify(profile.mileage),
      profile_lease_period: JSON.stringify(profile.lease_period),
      profile_inclusion: JSON.stringify(profile.inclusion),
      profile_specs: JSON.stringify(profile.specs),
      profile_fuel: JSON.stringify(profile.fuel),
    });
  }

  const breakdown: MatchScoreResult["breakdown"] = [];
  const missingData: string[] = [];

  // Check if priority filters exist and extract field names
  const hasPriorityFilters = profile.data &&
    typeof profile.data === "object" &&
    "priorityList" in profile.data &&
    Array.isArray(profile.data.priorityList) &&
    profile.data.priorityList.length > 0;

  // Extract field names from priorityList to avoid double-counting in standard fields
  const priorityListFieldNames = new Set<string>();
  if (hasPriorityFilters && profile.data && typeof profile.data === "object" && "priorityList" in profile.data) {
    const priorityList = profile.data.priorityList;
    if (Array.isArray(priorityList)) {
      for (const item of priorityList) {
        if (item && typeof item === "object" && "name" in item) {
          const fieldName = String(item.name);
          priorityListFieldNames.add(fieldName);
        }
      }
    }
  }

  // Track total weighted score and max possible weighted score across all fields
  let totalWeightedScore = 0;
  let totalMaxPossibleScore = 0;

  // Track standard fields and priority filters separately when priority filters exist
  let standardFieldsWeightedScore = 0;
  let standardFieldsMaxPossibleScore = 0;
  let priorityFiltersWeightedScore = 0;
  let priorityFiltersMaxPossibleScore = 0;

  // Helper to add weighted score directly with explicit business weights.
  const addWeightedScore = (score: number, fieldWeight: number) => {
    const weightedScore = score * fieldWeight;
    const maxWeightedScore = 100 * fieldWeight; // Max score is 100

    totalWeightedScore += weightedScore;
    totalMaxPossibleScore += maxWeightedScore;

    // Also track standard fields separately if priority filters exist
    if (hasPriorityFilters) {
      standardFieldsWeightedScore += weightedScore;
      standardFieldsMaxPossibleScore += maxWeightedScore;
    }
  };

  // 1. Monthly Price (Highest Priority) - lower prices get slightly higher scores
  const monthlyPriceMatch = calculatePriceRangeMatch(deal.monthly_price, profile.monthly_price);
  const monthlyPricePriority = getEffectivePriority("monthly_price", profile);
  if (deal.monthly_price === undefined) missingData.push("monthly_price");
  breakdown.push({
    field: "monthly_price",
    matched: monthlyPriceMatch.matched,
    score: monthlyPriceMatch.score,
    priority: monthlyPricePriority,
    details: monthlyPriceMatch.details,
  });
  // Only add score if profile field exists and has valid range (not [0, 0]) and not in priorityList
  if (!priorityListFieldNames.has("monthly_price") &&
      profile.monthly_price && !(profile.monthly_price.min === 0 && profile.monthly_price.max === 0)) {
    addWeightedScore(monthlyPriceMatch.score, MATCH_CATEGORY_WEIGHTS.monthly_price);
  }

  // 2. Deposit (Highest Priority) - lower deposits get slightly higher scores
  const depositMatch = calculatePriceRangeMatch(deal.deposit, profile.deposit);
  const depositPriority = getEffectivePriority("deposit", profile);
  if (deal.deposit === undefined) missingData.push("deposit");
  breakdown.push({
    field: "deposit",
    matched: depositMatch.matched,
    score: depositMatch.score,
    priority: depositPriority,
    details: depositMatch.details,
  });
  // Only add score if profile field exists and has valid range (not [0, 0]) and not in priorityList
  if (!priorityListFieldNames.has("deposit") &&
      profile.deposit && !(profile.deposit.min === 0 && profile.deposit.max === 0)) {
    addWeightedScore(depositMatch.score, MATCH_CATEGORY_WEIGHTS.deposit);
  }

  // 3. Deal Mileage (Highest Priority) - higher is better
  const mileageMatch = calculateMileageMatch(deal.yearly_mileage, profile.mileage);
  const mileagePriority = getEffectivePriority("mileage", profile);
  if (deal.yearly_mileage === undefined) missingData.push("yearly_mileage");
  breakdown.push({
    field: "mileage",
    matched: mileageMatch.matched,
    score: mileageMatch.score,
    priority: mileagePriority,
    details: mileageMatch.details,
  });
  // Only add score if profile field exists and has valid range (not [0, 0]) and not in priorityList
  if (!priorityListFieldNames.has("mileage") &&
      profile.mileage && !(profile.mileage.min === 0 && profile.mileage.max === 0)) {
    addWeightedScore(mileageMatch.score, MATCH_CATEGORY_WEIGHTS.mileage);
  }

  // 4. Lease Period (Highest Priority)
  const leasePeriodMatch = calculateRangeMatch(deal.lease_period, profile.lease_period);
  const leasePeriodPriority = getEffectivePriority("lease_period", profile);
  if (deal.lease_period === undefined) missingData.push("lease_period");
  breakdown.push({
    field: "lease_period",
    matched: leasePeriodMatch.matched,
    score: leasePeriodMatch.score,
    priority: leasePeriodPriority,
    details: leasePeriodMatch.details,
  });
  // Only add score if profile field exists and has valid range (not [0, 0]) and not in priorityList
  if (!priorityListFieldNames.has("lease_period") &&
      profile.lease_period && !(profile.lease_period.min === 0 && profile.lease_period.max === 0)) {
    addWeightedScore(leasePeriodMatch.score, MATCH_CATEGORY_WEIGHTS.lease_period);
  }

  // 5. Make (Second Priority) - profile uses make IDs (numbers)
  // Extract make ID from deal.car (stored as make_id in routes.ts)
  const getMakeId = (deal: DealWithCarDetails): number | undefined => {
    if (!deal.car) return undefined;
    // Use Record type to access additional properties (cast through unknown first)
    const car = deal.car as unknown as Record<string, unknown>;
    // Check if make_id is stored directly in car object
    if (car.make_id && typeof car.make_id === "number") {
      return car.make_id;
    }
    // Fallback: try to get from car.make if it's an object with id
    const make = car.make;
    if (make && typeof make === "object" && !Array.isArray(make) && "id" in make) {
      const makeId = (make as { id?: unknown }).id;
      return typeof makeId === "number" ? makeId : undefined;
    }
    return undefined;
  };

  const getModelId = (deal: DealWithCarDetails): number | undefined => {
    if (!deal.car) return undefined;
    // Use Record type to access additional properties (cast through unknown first)
    const car = deal.car as unknown as Record<string, unknown>;
    // Check if model_id is stored directly in car object
    if (car.model_id && typeof car.model_id === "number") {
      return car.model_id;
    }
    // Fallback: try to get from car.model if it's an object with id
    const model = car.model;
    if (model && typeof model === "object" && !Array.isArray(model) && "id" in model) {
      const modelId = (model as { id?: unknown }).id;
      return typeof modelId === "number" ? modelId : undefined;
    }
    return undefined;
  };

  // 6. Make (Second Priority) - profile uses make IDs (numbers)
  // Any matching make gives full score (100%)
  if (profile.make && profile.make.length > 0) {
    const dealMakeId = getMakeId(deal);
    const makeMatch = calculateArrayMatch(
      dealMakeId,
      profile.make,
      "make",
      (v) => v,
    );
    const makePriority = getEffectivePriority("make", profile);
    if (dealMakeId === undefined) missingData.push("car.make");
    breakdown.push({
      field: "make",
      matched: makeMatch.matched,
      score: makeMatch.score,
      priority: makePriority,
      details: makeMatch.details,
    });
    addWeightedScore(makeMatch.score, MATCH_CATEGORY_WEIGHTS.make);
  }

  // 7. Model (Second Priority) - profile uses model IDs (numbers)
  // Any matching model gives full score (100%)
  if (profile.model && profile.model.length > 0) {
    const dealModelId = getModelId(deal);
    const modelMatch = calculateArrayMatch(
      dealModelId,
      profile.model,
      "model",
      (v) => v,
    );
    const modelPriority = getEffectivePriority("model", profile);
    if (dealModelId === undefined) missingData.push("car.model");
    breakdown.push({
      field: "model",
      matched: modelMatch.matched,
      score: modelMatch.score,
      priority: modelPriority,
      details: modelMatch.details,
    });
    addWeightedScore(modelMatch.score, MATCH_CATEGORY_WEIGHTS.model);
  }

  // 8. Fuel (Second Priority)
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("fuel") && profile.fuel && profile.fuel.length > 0) {
    const fuelMatch = calculateArrayMatch(
      deal.car?.fuel,
      profile.fuel,
      "fuel",
      (v) => v,
    );
    const fuelPriority = getEffectivePriority("fuel", profile);
    if (deal.car?.fuel === undefined) missingData.push("car.fuel");
    breakdown.push({
      field: "fuel",
      matched: fuelMatch.matched,
      score: fuelMatch.score,
      priority: fuelPriority,
      details: fuelMatch.details,
    });
    addWeightedScore(fuelMatch.score, MATCH_CATEGORY_WEIGHTS.fuel);
  }

  // 9.1 Wheel Drive - profile uses wheel_drive IDs (numbers), lookup codes from x1_90
  if (profile.wheel_drive && profile.wheel_drive.length > 0) {
    const wheelDriveMatch = await calculateWheelDriveMatch(
      deal.car?.wheel_drive,
      profile.wheel_drive,
      wheelDriveCache,
    );
    const wheelDrivePriority = getEffectivePriority("wheel_drive", profile);
    if (deal.car?.wheel_drive === undefined) missingData.push("car.wheel_drive");
    breakdown.push({
      field: "wheel_drive",
      matched: wheelDriveMatch.matched,
      score: wheelDriveMatch.score,
      priority: wheelDrivePriority,
      details: wheelDriveMatch.details,
    });
    addWeightedScore(wheelDriveMatch.score, MATCH_CATEGORY_WEIGHTS.wheel_drive);
  }

  // 9. Transmission (Second Priority)
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("transmission") && profile.transmission && profile.transmission.length > 0) {
    const transmissionMatch = calculateArrayMatch(
      deal.car?.transmission,
      profile.transmission,
      "transmission",
      (v) => v,
    );
    const transmissionPriority = getEffectivePriority("transmission", profile);
    if (deal.car?.transmission === undefined) missingData.push("car.transmission");
    breakdown.push({
      field: "transmission",
      matched: transmissionMatch.matched,
      score: transmissionMatch.score,
      priority: transmissionPriority,
      details: transmissionMatch.details,
    });
    addWeightedScore(transmissionMatch.score, MATCH_CATEGORY_WEIGHTS.transmission);
  }

  // 10. Color (Second Priority) - profile uses color IDs (numbers), lookup values from x1_35
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("color") && profile.color && profile.color.length > 0) {
    const colorMatch = await calculateColorMatch(deal.car?.color, profile.color, colorCache);
    const colorPriority = getEffectivePriority("color", profile);
    if (deal.car?.color === undefined) missingData.push("car.color");
    breakdown.push({
      field: "color",
      matched: colorMatch.matched,
      score: colorMatch.score,
      priority: colorPriority,
      details: colorMatch.details,
    });
    addWeightedScore(colorMatch.score, MATCH_CATEGORY_WEIGHTS.color);
  }

  // 11. Body (Second Priority) - profile uses body IDs (numbers), lookup codes from x1_64
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("body") && profile.body && profile.body.length > 0) {
    const bodyMatch = await calculateBodyMatch(deal.car?.body, profile.body, bodyCache);
    const bodyPriority = getEffectivePriority("body", profile);
    if (deal.car?.body === undefined) missingData.push("car.body");
    breakdown.push({
      field: "body",
      matched: bodyMatch.matched,
      score: bodyMatch.score,
      priority: bodyPriority,
      details: bodyMatch.details,
    });
    addWeightedScore(bodyMatch.score, MATCH_CATEGORY_WEIGHTS.body);
  }

  // 12. Tax Class (Third Priority)
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("tax_class") && profile.tax_class && profile.tax_class.length > 0) {
    const taxClassMatch = calculateArrayMatch(
      deal.car?.tax_class,
      profile.tax_class,
      "tax_class",
      (v) => v,
    );
    const taxClassPriority = getEffectivePriority("tax_class", profile);
    if (deal.car?.tax_class === undefined) missingData.push("car.tax_class");
    breakdown.push({
      field: "tax_class",
      matched: taxClassMatch.matched,
      score: taxClassMatch.score,
      priority: taxClassPriority,
      details: taxClassMatch.details,
    });
    addWeightedScore(taxClassMatch.score, MATCH_CATEGORY_WEIGHTS.tax_class);
  }

  // 13. Weight (Third Priority)
  if (profile.weight && profile.weight.length > 0) {
    const weightRange = profile.weight[0]; // Use first weight preference
    const weightMatch = calculateRangeMatch(deal.car?.weight, weightRange);
    const weightPriority = getEffectivePriority("weight", profile);
    if (deal.car?.weight === undefined) missingData.push("car.weight");
    breakdown.push({
      field: "weight",
      matched: weightMatch.matched,
      score: weightMatch.score,
      priority: weightPriority,
      details: weightMatch.details,
    });
    addWeightedScore(weightMatch.score, MATCH_CATEGORY_WEIGHTS.weight);
  }

  // 14. Horsepower (Third Priority)
  if (profile.horsepower && profile.horsepower.length > 0) {
    const horsepowerRange = profile.horsepower[0]; // Use first horsepower preference
    const horsepowerMatch = calculateRangeMatch(deal.car?.horsepower, horsepowerRange);
    const horsepowerPriority = getEffectivePriority("horsepower", profile);
    if (deal.car?.horsepower === undefined) missingData.push("car.horsepower");
    breakdown.push({
      field: "horsepower",
      matched: horsepowerMatch.matched,
      score: horsepowerMatch.score,
      priority: horsepowerPriority,
      details: horsepowerMatch.details,
    });
    addWeightedScore(horsepowerMatch.score, MATCH_CATEGORY_WEIGHTS.horsepower);
  }

  // 15. Battery Capacity (Third Priority)
  if (profile.batterycap && profile.batterycap.length > 0) {
    const batterycapRange = profile.batterycap[0]; // Use first batterycap preference
    const batterycapMatch = calculateRangeMatch(deal.car?.batterycap, batterycapRange);
    const batterycapPriority = getEffectivePriority("batterycap", profile);
    if (deal.car?.batterycap === undefined) missingData.push("car.batterycap");
    breakdown.push({
      field: "batterycap",
      matched: batterycapMatch.matched,
      score: batterycapMatch.score,
      priority: batterycapPriority,
      details: batterycapMatch.details,
    });
    addWeightedScore(batterycapMatch.score, MATCH_CATEGORY_WEIGHTS.batterycap);
  }

  // 16. Battery Range (Third Priority)
  if (profile.battery_range && profile.battery_range.length > 0) {
    // Battery range is typically calculated from battery capacity, so we'll check if car has batterycap
    // For now, we'll mark it as not applicable if car doesn't have batterycap
    const batteryRangePriority = getEffectivePriority("battery_range", profile);
    if (deal.car?.batterycap === undefined) {
      missingData.push("car.batterycap (needed for battery_range calculation)");
      breakdown.push({
        field: "battery_range",
        matched: false,
        score: 0,
        priority: batteryRangePriority,
        details: "Cannot calculate without batterycap",
      });
    } else {
      // Note: Actual battery range calculation would require additional data
      breakdown.push({
        field: "battery_range",
        matched: false,
        score: 0,
        priority: batteryRangePriority,
        details: "Battery range calculation not implemented",
      });
    }
  }

  // 17. Specs (Third Priority)
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("specs") && profile.specs && profile.specs.length > 0) {
    const specsMatch = calculateNumberArrayMatch(deal.car?.spec, profile.specs, "specs");
    const specsPriority = getEffectivePriority("specs", profile);
    if (!deal.car?.spec || deal.car.spec.length === 0) missingData.push("car.spec");
    breakdown.push({
      field: "specs",
      matched: specsMatch.matched,
      score: specsMatch.score,
      priority: specsPriority,
      details: specsMatch.details,
    });
    addWeightedScore(specsMatch.score, MATCH_CATEGORY_WEIGHTS.specs);
  }

  // 18. Inclusion (Third Priority)
  // Only calculate if profile field exists and has items and not in priorityList
  if (!priorityListFieldNames.has("inclusion") && profile.inclusion && profile.inclusion.length > 0) {
    const inclusionIds = deal.inclusion?.map((inc) => inc.id) || [];
    const inclusionMatch = calculateNumberArrayMatch(inclusionIds, profile.inclusion, "inclusion");
    const inclusionPriority = getEffectivePriority("inclusion", profile);
    if (!deal.inclusion || deal.inclusion.length === 0) missingData.push("inclusion");
    breakdown.push({
      field: "inclusion",
      matched: inclusionMatch.matched,
      score: inclusionMatch.score,
      priority: inclusionPriority,
      details: inclusionMatch.details,
    });
    addWeightedScore(inclusionMatch.score, MATCH_CATEGORY_WEIGHTS.inclusion);
  }

  // 19. PriorityList from data field (Dynamic Priority based on index)
  // Process priorityList if it exists in profile.data
  if (hasPriorityFilters) {
    const priorityList = profile.data.priorityList;
    if (Array.isArray(priorityList) && priorityList.length > 0) {
      // Weight decreases by 1 for each index: index 0 = 10, index 1 = 9, index 2 = 8, etc.
      const maxPriorityListWeight = 10; // Maximum weight for first item (index 0)

      // First pass: Check if any fuel/body/transmission values match
      // If any match, all items of that field type will get points
      const fuelValues: string[] = [];
      const bodyValues: string[] = [];
      const transmissionValues: string[] = [];
      let hasFuelMatch = false;
      let hasBodyMatch = false;
      let hasTransmissionMatch = false;

      // Collect all fuel/body/transmission values from priority list
      for (let i = 0; i < priorityList.length; i++) {
        const item = priorityList[i];
        if (!item || typeof item !== "object" || !("name" in item) || !("value" in item)) {
          continue;
        }
        const fieldName = String(item.name);
        const fieldValue = item.value;

        if (fieldName === "fuel" && typeof fieldValue === "string") {
          fuelValues.push(fieldValue);
          if (deal.car?.fuel === fieldValue) {
            hasFuelMatch = true;
          }
        } else if (fieldName === "body" && typeof fieldValue === "string") {
          bodyValues.push(fieldValue);
          if (deal.car?.body === fieldValue) {
            hasBodyMatch = true;
          }
        } else if (fieldName === "transmission" && typeof fieldValue === "string") {
          transmissionValues.push(fieldValue);
          if (deal.car?.transmission === fieldValue) {
            hasTransmissionMatch = true;
          }
        }
      }

      // Second pass: Process all items and apply group matching for fuel/body/transmission
      for (let i = 0; i < priorityList.length; i++) {
        const item = priorityList[i];
        if (!item || typeof item !== "object" || !("name" in item) || !("value" in item)) {
          continue; // Skip invalid items
        }

        const fieldName = String(item.name);
        const fieldValue = item.value;
        const itemWeight = maxPriorityListWeight - i; // Index 0 = 10, index 1 = 9, index 2 = 8, etc.

        // Match based on field name
        let matchResult: { matched: boolean; score: number; details: string } | null = null;

        switch (fieldName) {
        case "fuel":
          if (typeof fieldValue === "string") {
            // If any fuel value matches, all fuel items get points
            const fuelMatch = hasFuelMatch;
            matchResult = {
              matched: fuelMatch,
              score: fuelMatch ? 100 : 0,
              details: fuelMatch ?
                `Matched: ${fieldValue} (group match: any fuel value matched)` :
                `No match for ${fieldValue}`,
            };
          }
          break;

        case "tax_class":
          if (typeof fieldValue === "string") {
            const taxClassMatch = deal.car?.tax_class === fieldValue;
            matchResult = {
              matched: taxClassMatch,
              score: taxClassMatch ? 100 : 0,
              details: taxClassMatch ? `Matched: ${fieldValue}` : `No match for ${fieldValue}`,
            };
          }
          break;

        case "body":
          if (typeof fieldValue === "string") {
            // If any body value matches, all body items get points
            const bodyMatch = hasBodyMatch;
            matchResult = {
              matched: bodyMatch,
              score: bodyMatch ? 100 : 0,
              details: bodyMatch ?
                `Matched: ${fieldValue} (group match: any body value matched)` :
                `No match for ${fieldValue}`,
            };
          }
          break;

        case "color":
          if (typeof fieldValue === "string") {
            // Color matching requires lookup, but for priorityList we'll do simple string match
            const colorMatch = deal.car?.color === fieldValue;
            matchResult = {
              matched: colorMatch,
              score: colorMatch ? 100 : 0,
              details: colorMatch ? `Matched: ${fieldValue}` : `No match for ${fieldValue}`,
            };
          }
          break;

        case "monthly_price":
          if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
            const [min, max] = fieldValue;
            const dealPrice = deal.monthly_price;
            if (dealPrice !== undefined) {
              const matched = isInRange(dealPrice, min, max);
              let details: string;
              if (max === 0 && min !== 0) {
                details = matched ?
                  `Value ${dealPrice} >= ${min} (max=0 means >= min)` :
                  `Value ${dealPrice} < ${min} (max=0 means >= min)`;
              } else {
                details = matched ?
                  `Value ${dealPrice} within range [${min}, ${max ?? "unlimited"}]` :
                  `Value ${dealPrice} outside range [${min}, ${max ?? "unlimited"}]`;
              }
              matchResult = {
                matched,
                score: matched ? 100 : 0,
                details,
              };
            }
          }
          break;

        case "deposit":
          if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
            const [min, max] = fieldValue;
            const dealDeposit = deal.deposit;
            if (dealDeposit !== undefined) {
              const matched = isInRange(dealDeposit, min, max);
              let details: string;
              if (max === 0 && min !== 0) {
                details = matched ?
                  `Value ${dealDeposit} >= ${min} (max=0 means >= min)` :
                  `Value ${dealDeposit} < ${min} (max=0 means >= min)`;
              } else {
                details = matched ?
                  `Value ${dealDeposit} within range [${min}, ${max ?? "unlimited"}]` :
                  `Value ${dealDeposit} outside range [${min}, ${max ?? "unlimited"}]`;
              }
              matchResult = {
                matched,
                score: matched ? 100 : 0,
                details,
              };
            }
          }
          break;

        case "lease_period":
          if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
            const [min, max] = fieldValue;
            const dealLeasePeriod = deal.lease_period;
            if (dealLeasePeriod !== undefined) {
              const matched = isInRange(dealLeasePeriod, min, max);
              let details: string;
              if (max === 0 && min !== 0) {
                details = matched ?
                  `Value ${dealLeasePeriod} >= ${min} (max=0 means >= min)` :
                  `Value ${dealLeasePeriod} < ${min} (max=0 means >= min)`;
              } else {
                details = matched ?
                  `Value ${dealLeasePeriod} within range [${min}, ${max ?? "unlimited"}]` :
                  `Value ${dealLeasePeriod} outside range [${min}, ${max ?? "unlimited"}]`;
              }
              matchResult = {
                matched,
                score: matched ? 100 : 0,
                details,
              };
            }
          }
          break;

        case "mileage":
          if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
            const [min] = fieldValue; // Only need min for "higher is better" logic
            const dealMileage = deal.yearly_mileage;
            if (dealMileage !== undefined) {
              // Mileage: higher is better
              const matched = dealMileage >= min;
              matchResult = {
                matched,
                score: matched ? 100 : 0,
                details: matched ?
                  `Value ${dealMileage} >= ${min} (higher is better)` :
                  `Value ${dealMileage} < ${min}`,
              };
            }
          }
          break;

        case "battery_range":
          if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
            // Battery range is not directly in deal, might need special handling
            // For now, skip or handle if available
            matchResult = null;
          }
          break;

        case "inclusion":
          if (typeof fieldValue === "number") {
            const inclusionIds = deal.inclusion?.map((inc) => inc.id) || [];
            const matched = inclusionIds.includes(fieldValue);
            matchResult = {
              matched,
              score: matched ? 100 : 0,
              details: matched ? `Matched inclusion: ${fieldValue}` : `No match for inclusion ${fieldValue}`,
            };
          }
          break;

        case "specs":
          if (typeof fieldValue === "number") {
            const specIds = deal.car?.spec || [];
            const matched = specIds.includes(fieldValue);
            matchResult = {
              matched,
              score: matched ? 100 : 0,
              details: matched ? `Matched spec: ${fieldValue}` : `No match for spec ${fieldValue}`,
            };
          }
          break;

        case "transmission":
          if (typeof fieldValue === "string") {
            // If any transmission value matches, all transmission items get points
            const transmissionMatch = hasTransmissionMatch;
            matchResult = {
              matched: transmissionMatch,
              score: transmissionMatch ? 100 : 0,
              details: transmissionMatch ?
                `Matched: ${fieldValue} (group match: any transmission value matched)` :
                `No match for ${fieldValue}`,
            };
          }
          break;

        case "seat":
          if (typeof fieldValue === "number") {
            const dealSeat = deal.car?.seat;
            const matched = dealSeat === fieldValue;
            matchResult = {
              matched,
              score: matched ? 100 : 0,
              details: matched ? `Matched seat: ${fieldValue}` : `No match for seat ${fieldValue}`,
            };
          }
          break;

          // Skip fields that are not directly matchable (zipcode, dealership, etc.)
        default:
          matchResult = null;
          break;
        }

        // Add to breakdown and weighted score if match result exists
        if (matchResult) {
          breakdown.push({
            field: `priorityList_${fieldName}_${i}`,
            matched: matchResult.matched,
            score: matchResult.score,
            priority: PriorityLevel.HIGHEST, // PriorityList items use highest priority level
            details: `PriorityList[${i}]: ${matchResult.details} (weight: ${itemWeight.toFixed(2)})`,
          });

          // Add weighted score using dynamic weight (no priority weight multiplier here)
          // Priority filters will get 60% weight in final calculation
          const weightedScore = matchResult.score * itemWeight;
          const maxWeightedScore = 100 * itemWeight;

          // Track priority filters separately
          priorityFiltersWeightedScore += weightedScore;
          priorityFiltersMaxPossibleScore += maxWeightedScore;
        }
      }
    }
  }

  // Calculate final score based on whether priority filters exist
  let finalScore: number;
  if (hasPriorityFilters && priorityFiltersMaxPossibleScore > 0) {
    // Priority filters exist: 60% weight for priority filters, 40% for standard fields
    const standardFieldsContribution = standardFieldsMaxPossibleScore > 0 ?
      (standardFieldsWeightedScore / standardFieldsMaxPossibleScore) * 0.4 : 0;
    const priorityFiltersContribution = (priorityFiltersWeightedScore / priorityFiltersMaxPossibleScore) * 0.6;

    // Final score is the sum of both contributions, scaled to 99
    finalScore = (standardFieldsContribution + priorityFiltersContribution) * 99;
  } else {
    // No priority filters: use normal flow
  // Calculate final score: (totalWeightedScore / totalMaxPossibleScore) * 99
  // This ensures if all fields match perfectly, score = 99
    finalScore = totalMaxPossibleScore > 0 ?
      (totalWeightedScore / totalMaxPossibleScore) * 99 :
      0;
  }

  // Cap at 99 and keep decimals (round to 2 decimal places)
  const cappedScore = Math.min(99, Math.round(finalScore * 100) / 100);

  logger.info("Match score generated", {
    profileId: profile.id,
    dealId: deal.id,
    score: cappedScore,
    hasPriorityFilters,
    totalWeightedScore: totalWeightedScore.toFixed(2),
    totalMaxPossibleScore: totalMaxPossibleScore.toFixed(2),
    standardFieldsWeightedScore: hasPriorityFilters ? standardFieldsWeightedScore.toFixed(2) : "N/A",
    standardFieldsMaxPossibleScore: hasPriorityFilters ? standardFieldsMaxPossibleScore.toFixed(2) : "N/A",
    priorityFiltersWeightedScore: hasPriorityFilters ? priorityFiltersWeightedScore.toFixed(2) : "N/A",
    priorityFiltersMaxPossibleScore: hasPriorityFilters ? priorityFiltersMaxPossibleScore.toFixed(2) : "N/A",
    missingDataCount: missingData.length,
  });

  // Also log as a single line for better visibility
  logger.info(`Match score: profileId=${profile.id}, dealId=${deal.id}, score=${cappedScore}`);

  return {
    score: cappedScore,
    breakdown,
    missingData,
  };
}

