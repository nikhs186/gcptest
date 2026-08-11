"use strict";
/**
 * Matching Helper
 * Functions to fetch deals and calculate match scores for profile-based matching
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMatchingDeals = getMatchingDeals;
const logger = __importStar(require("../logger"));
const app_1 = require("firebase-admin/app");
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const pg_js_1 = require("./pg.js");
const deals_js_1 = require("./deals.js");
const matchScore_js_1 = require("./matchScore.js");
const auth_js_1 = require("./auth.js");
const dealFormatters_js_1 = require("./dealFormatters.js");
// Initialize Firebase Admin if not already initialized
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
const MATCHING_SESSIONS_COLLECTION = "matching";
const SESSION_TTL_HOURS = 24; // Sessions expire after 24 hours
const DEBUG_PROFILE_ID = "bcff9ef6-b223-4720-89fb-02f0080ac9cc";
/**
 * Gets deal IDs and match scores for a specific page from an existing matching session
 * Returns a map of dealId -> matchScore
 */
async function getMatchingDealIdsForPage(sessionId, page) {
    try {
        const sessionDoc = await db.collection(MATCHING_SESSIONS_COLLECTION).doc(sessionId).get();
        if (!sessionDoc.exists) {
            logger.info(`Matching session ${sessionId} not found`);
            return null;
        }
        const sessionData = sessionDoc.data();
        const now = firestore_1.Timestamp.now();
        // Check if session is expired
        if (sessionData && sessionData.expiresAt && sessionData.expiresAt.toMillis() < now.toMillis()) {
            logger.info(`Matching session ${sessionId} has expired`);
            await db.collection(MATCHING_SESSIONS_COLLECTION).doc(sessionId).delete();
            return null;
        }
        // Read page document from subcollection
        const pageDoc = await db
            .collection(MATCHING_SESSIONS_COLLECTION)
            .doc(sessionId)
            .collection("pages")
            .doc(String(page))
            .get();
        if (!pageDoc.exists) {
            logger.info(`Page ${page} not found in matching session ${sessionId}`);
            return null;
        }
        const pageData = pageDoc.data();
        const deals = (pageData === null || pageData === void 0 ? void 0 : pageData.deals) || null; // Array of {dealId, matchScore}
        if (!deals || !Array.isArray(deals)) {
            return null;
        }
        // Convert array to Map for easy lookup
        const dealScoreMap = new Map();
        deals.forEach((deal) => {
            if (deal.dealId && typeof deal.matchScore === "number") {
                dealScoreMap.set(deal.dealId, deal.matchScore);
            }
        });
        return dealScoreMap;
    }
    catch (error) {
        logger.error("Error reading page from matching session", { error, sessionId, page });
        return null;
    }
}
/**
 * Creates a matching session with all pages at once using Firestore batch writes
 * Pages contain both dealId and matchScore
 */
async function createMatchingSessionWithPages(sessionId, pages, totalItems) {
    try {
        const now = firestore_1.Timestamp.now();
        const expiresAt = firestore_1.Timestamp.fromMillis(now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000));
        const sessionRef = db.collection(MATCHING_SESSIONS_COLLECTION).doc(sessionId);
        const pageEntries = Object.entries(pages);
        const BATCH_LIMIT = 500; // Firestore batch limit
        // Use Firestore batch write for better performance
        if (pageEntries.length <= BATCH_LIMIT - 1) {
            // All pages fit in one batch (minus 1 for base document)
            const batch = db.batch();
            // Create base document with metadata
            batch.set(sessionRef, {
                sessionId,
                createdAt: now,
                expiresAt,
                totalItems,
            });
            // Write each page as a subcollection document with deals (dealId + matchScore)
            const pagesRef = sessionRef.collection("pages");
            pageEntries.forEach(([pageNum, deals]) => {
                batch.set(pagesRef.doc(pageNum), {
                    page: Number(pageNum),
                    deals: deals, // Array of {dealId, matchScore}
                });
            });
            await batch.commit();
        }
        else {
            // Too many pages - split into multiple batches
            let firstBatch = db.batch();
            firstBatch.set(sessionRef, {
                sessionId,
                createdAt: now,
                expiresAt,
                totalItems,
            });
            const pagesRef = sessionRef.collection("pages");
            let batchOpCount = 1; // Base document
            for (const [pageNum, deals] of pageEntries) {
                if (batchOpCount >= BATCH_LIMIT) {
                    await firstBatch.commit();
                    firstBatch = db.batch();
                    batchOpCount = 0;
                }
                firstBatch.set(pagesRef.doc(pageNum), {
                    page: Number(pageNum),
                    deals: deals, // Array of {dealId, matchScore}
                });
                batchOpCount++;
            }
            if (batchOpCount > 0) {
                await firstBatch.commit();
            }
        }
        logger.info("Matching session created in Firestore", {
            sessionId,
            pagesCount: pageEntries.length,
            totalItems,
        });
    }
    catch (error) {
        logger.error("Error creating matching session with pages", { error, sessionId });
        throw error;
    }
}
function toNumber(value) {
    if (typeof value === "number" && !isNaN(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}
// Fields where [0, 0] with isZero=true means "exactly zero" instead of "open range"
const ALLOW_ZERO_ZERO_FIELDS = ["deposit"];
function normalizeRangeFilter(value, fieldName) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const min = toNumber(value.min);
    const max = toNumber(value.max);
    if (min === null) {
        return undefined;
    }
    // Profile ranges can use 0/null as "open max"; getDeals treats [min] as ">= min".
    if (max === null) {
        return [min];
    }
    // For allowed fields, [0, 0] with isZero=true means "only deals with exactly zero"
    if (max === 0 && min === 0 && value.isZero === true && fieldName && ALLOW_ZERO_ZERO_FIELDS.includes(fieldName)) {
        return [0, 0];
    }
    if (max <= 0) {
        return [min];
    }
    return [min, max];
}
function mergeUniqueStringArray(existing, incoming) {
    if (!existing || existing.length === 0) {
        return incoming.length > 0 ? [...new Set(incoming)] : undefined;
    }
    if (incoming.length === 0) {
        return existing;
    }
    const incomingSet = new Set(incoming);
    const intersection = existing.filter((value) => incomingSet.has(value));
    return intersection.length > 0 ? [...new Set(intersection)] : undefined;
}
function mergeUniqueNumberArray(existing, incoming) {
    if (!existing || existing.length === 0) {
        return incoming.length > 0 ? [...new Set(incoming)] : undefined;
    }
    if (incoming.length === 0) {
        return existing;
    }
    const incomingSet = new Set(incoming);
    const intersection = existing.filter((value) => incomingSet.has(value));
    return intersection.length > 0 ? [...new Set(intersection)] : undefined;
}
function buildProfilePriorityFilters(profile, baseFilters, colorCache, bodyCache, wheelDriveCacheParam) {
    var _a, _b, _c, _d;
    const fuel = (profile.fuel || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.fuel);
    const transmission = (profile.transmission || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.transmission);
    // Profile stores wheel_drive as IDs; convert to deal filter values from pre-fetched cache.
    const wheelDrive = (profile.wheel_drive || [])
        .filter((item) => item.priority === 1)
        .map((item) => wheelDriveCacheParam.get(item.wheel_drive))
        .filter((value) => typeof value === "string" && value.length > 0);
    // Profile stores color/body as IDs; convert to deal filter values from pre-fetched caches.
    const color = (profile.color || [])
        .filter((item) => item.priority === 1)
        .map((item) => colorCache.get(item.color))
        .filter((value) => typeof value === "string" && value.length > 0);
    const body = (profile.body || [])
        .filter((item) => item.priority === 1)
        .map((item) => bodyCache.get(item.body))
        .filter((value) => typeof value === "string" && value.length > 0);
    const taxClass = (profile.tax_class || [])
        .map((item) => item.tax_class)
        .filter((v) => typeof v === "string" && v.length > 0);
    const make = (profile.make || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.make);
    const model = (profile.model || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.model);
    let seatRange;
    for (const item of (profile.seat || [])) {
        if (item.priority !== 1)
            continue;
        const seatObj = item;
        const lo = Number(seatObj.min) || 0;
        const hi = Number(seatObj.max) || 0;
        seatRange = hi > 0 ? [lo, hi] : [lo];
        break;
    }
    const inclusion = (profile.inclusion || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.inclusion);
    const spec = (profile.specs || [])
        .filter((item) => item.priority === 1)
        .map((item) => item.specs);
    const monthlyPrice = ((_a = profile.monthly_price) === null || _a === void 0 ? void 0 : _a.priority) === 1 ? normalizeRangeFilter(profile.monthly_price) : undefined;
    const deposit = ((_b = profile.deposit) === null || _b === void 0 ? void 0 : _b.priority) === 1 ? normalizeRangeFilter(profile.deposit, "deposit") : undefined;
    const leasePeriod = ((_c = profile.lease_period) === null || _c === void 0 ? void 0 : _c.priority) === 1 ? normalizeRangeFilter(profile.lease_period) : undefined;
    const mileage = ((_d = profile.mileage) === null || _d === void 0 ? void 0 : _d.priority) === 1 ? normalizeRangeFilter(profile.mileage) : undefined;
    const mapped = {};
    const mergedFuel = mergeUniqueStringArray(baseFilters.fuel, fuel);
    if (mergedFuel)
        mapped.fuel = mergedFuel;
    const mergedTransmission = mergeUniqueStringArray(baseFilters.transmission, transmission);
    if (mergedTransmission)
        mapped.transmission = mergedTransmission;
    const mergedWheelDrive = mergeUniqueStringArray(baseFilters.wheel_drive, wheelDrive);
    if (mergedWheelDrive)
        mapped.wheel_drive = mergedWheelDrive;
    const mergedBody = mergeUniqueStringArray(baseFilters.body, body);
    if (mergedBody)
        mapped.body = mergedBody;
    const mergedColor = mergeUniqueStringArray(baseFilters.color, color);
    if (mergedColor)
        mapped.color = mergedColor;
    const mergedTaxClass = mergeUniqueStringArray(baseFilters.tax_class, taxClass);
    if (mergedTaxClass)
        mapped.tax_class = mergedTaxClass;
    const mergedMake = mergeUniqueNumberArray(baseFilters.make, make);
    if (mergedMake)
        mapped.make = mergedMake;
    const mergedModel = mergeUniqueNumberArray(baseFilters.model, model);
    if (mergedModel)
        mapped.model = mergedModel;
    if (!baseFilters.seat_range && seatRange) {
        mapped.seat_range = seatRange;
    }
    const mergedInclusion = mergeUniqueNumberArray(baseFilters.inclusion, inclusion);
    if (mergedInclusion)
        mapped.inclusion = mergedInclusion;
    const mergedSpec = mergeUniqueNumberArray(baseFilters.spec, spec);
    if (mergedSpec)
        mapped.spec = mergedSpec;
    if (!baseFilters.monthly_price && monthlyPrice) {
        mapped.monthly_price = monthlyPrice;
    }
    if (!baseFilters.deposit && deposit) {
        mapped.deposit = deposit;
    }
    if (!baseFilters.lease_period && leasePeriod) {
        mapped.lease_period = leasePeriod;
    }
    if (!baseFilters.mileage && mileage) {
        mapped.mileage = mileage;
    }
    return mapped;
}
/**
 * Fetches deals with match scores calculated and sorted by match score descending
 * @param req - Express request object
 * @param filters - Deal filters
 * @param consumerId - Optional consumer ID for favorites
 * @param profileId - Profile ID for match score calculation
 * @returns Promise with deals sorted by match score
 */
async function getMatchingDeals(req, filters, consumerId, profileId) {
    var _a;
    const isDebugProfile = profileId === DEBUG_PROFILE_ID;
    // Fetch profile data
    const profileQuery = `
    SELECT *
    FROM public.x1_14
    WHERE id = $1::uuid
    LIMIT 1
  `;
    const profileResult = await (0, pg_js_1.executeQuery)(profileQuery, [profileId]);
    if (profileResult.rows.length === 0) {
        throw new Error(`Profile with id '${profileId}' not found`);
    }
    const profileRow = profileResult.rows[0];
    const consumerProfile = (0, matchScore_js_1.normalizeProfileData)(profileRow);
    logger.info("Profile loaded for matching", { profileId });
    // Pre-fetch color, body, and wheel_drive data into caches to avoid database queries during score calculation
    // This is a critical performance optimization - without this, we'd make thousands of DB queries
    const colorCache = new Map();
    const bodyCache = new Map();
    const wheelDriveCache = new Map();
    // Pre-fetch all colors needed for this profile
    if (consumerProfile.color && consumerProfile.color.length > 0) {
        const colorIds = consumerProfile.color.map((c) => c.color);
        const uniqueColorIds = [...new Set(colorIds)];
        const colorPromises = uniqueColorIds.map(async (colorId) => {
            try {
                const colorQuery = `
          SELECT name
          FROM public.x1_35
          WHERE id = $1
          LIMIT 1
        `;
                const colorResult = await (0, pg_js_1.executeQuery)(colorQuery, [colorId]);
                const colorName = colorResult.rows.length > 0 ? colorResult.rows[0].name : null;
                colorCache.set(colorId, colorName);
                return { colorId, colorName };
            }
            catch (error) {
                logger.error("Error fetching color", { error, colorId });
                colorCache.set(colorId, null);
                return { colorId, colorName: null };
            }
        });
        await Promise.all(colorPromises);
        logger.info("Pre-fetched colors for profile", { colorCount: uniqueColorIds.length });
    }
    // Pre-fetch all body codes needed for this profile
    if (consumerProfile.body && consumerProfile.body.length > 0) {
        const bodyIds = consumerProfile.body.map((b) => b.body);
        const uniqueBodyIds = [...new Set(bodyIds)];
        const bodyPromises = uniqueBodyIds.map(async (bodyId) => {
            try {
                const bodyQuery = `
          SELECT code
          FROM public.x1_64
          WHERE id = $1
          LIMIT 1
        `;
                const bodyResult = await (0, pg_js_1.executeQuery)(bodyQuery, [bodyId]);
                const bodyCode = bodyResult.rows.length > 0 ? bodyResult.rows[0].code : null;
                bodyCache.set(bodyId, bodyCode);
                return { bodyId, bodyCode };
            }
            catch (error) {
                logger.error("Error fetching body code", { error, bodyId });
                bodyCache.set(bodyId, null);
                return { bodyId, bodyCode: null };
            }
        });
        await Promise.all(bodyPromises);
        logger.info("Pre-fetched body codes for profile", { bodyCount: uniqueBodyIds.length });
    }
    // Pre-fetch all wheel drive codes needed for this profile
    if (consumerProfile.wheel_drive && consumerProfile.wheel_drive.length > 0) {
        const wdIds = consumerProfile.wheel_drive.map((w) => w.wheel_drive);
        const uniqueWdIds = [...new Set(wdIds)];
        const wdPromises = uniqueWdIds.map(async (wdId) => {
            try {
                const wdQuery = `
          SELECT code
          FROM public.x1_90
          WHERE id = $1
          LIMIT 1
        `;
                const wdResult = await (0, pg_js_1.executeQuery)(wdQuery, [wdId]);
                const wdCode = wdResult.rows.length > 0 ? wdResult.rows[0].code : null;
                wheelDriveCache.set(wdId, wdCode);
                return { wdId, wdCode };
            }
            catch (error) {
                logger.error("Error fetching wheel drive code", { error, wdId });
                wheelDriveCache.set(wdId, null);
                return { wdId, wdCode: null };
            }
        });
        await Promise.all(wdPromises);
        logger.info("Pre-fetched wheel drive codes for profile", { wheelDriveCount: uniqueWdIds.length });
    }
    // Check for favourite filter
    const query = req.query;
    let favouriteFilter = false;
    if (query.favourite !== undefined) {
        const favouriteValue = String(query.favourite).toLowerCase();
        favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
    }
    if (!favouriteFilter && query.data) {
        try {
            let dataValue;
            if (typeof query.data === "string") {
                dataValue = JSON.parse(query.data);
            }
            else {
                dataValue = query.data;
            }
            if (dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)) {
                const dataObj = dataValue;
                if (dataObj.favourite !== undefined) {
                    if (typeof dataObj.favourite === "boolean") {
                        favouriteFilter = dataObj.favourite;
                    }
                    else {
                        const favouriteValue = String(dataObj.favourite).toLowerCase();
                        favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
                    }
                }
            }
        }
        catch (_b) {
            // Ignore parsing errors
        }
    }
    // Handle favourites filter
    let favoritedDealIds = null;
    if (favouriteFilter) {
        if (!consumerId) {
            favoritedDealIds = [];
        }
        else {
            favoritedDealIds = await (0, auth_js_1.getAllFavoritedDealIds)(consumerId);
        }
    }
    // Extract session ID from request (query parameter or data field)
    const rawPage = filters.page !== undefined ? filters.page : 1;
    const page = Math.max(1, Math.floor(typeof rawPage === "number" ? rawPage : parseInt(String(rawPage), 10) || 1));
    const rawPerPage = filters.perPage !== undefined ? filters.perPage : 20;
    const perPage = Math.max(1, Math.floor(typeof rawPerPage === "number" ? rawPerPage : parseInt(String(rawPerPage), 10) || 20));
    let sessionId = req.query.sessionId;
    if (!sessionId && req.query.data && typeof req.query.data === "string") {
        try {
            const data = JSON.parse(req.query.data);
            sessionId = data.sessionId || data.session_id;
        }
        catch (_c) {
            // Ignore parse errors
        }
    }
    logger.info("Matching request with session check", {
        profileId,
        page,
        perPage,
        sessionId: sessionId || "none",
    });
    // If page > 1, sessionId is required
    if (page > 1 && !sessionId) {
        throw new Error("Invalid session: sessionId is required for page > 1");
    }
    // If session ID provided, try to read from existing session first
    if (sessionId) {
        const dealScoreMap = await getMatchingDealIdsForPage(sessionId, page);
        if (dealScoreMap && dealScoreMap.size > 0) {
            // Use existing session - fast path
            const pageDealIds = Array.from(dealScoreMap.keys());
            logger.info("Using existing matching session", {
                sessionId,
                page,
                dealIdsCount: pageDealIds.length,
            });
            // Fetch and format deals using common helper function
            const dealsWithFavourites = await (0, dealFormatters_js_1.fetchAndFormatDeals)(pageDealIds, consumerId);
            // Use stored match scores from Firestore (no recalculation needed)
            const dealsWithScores = dealsWithFavourites.map((deal) => (Object.assign(Object.assign({}, deal), { matchScore: dealScoreMap.get(deal.id) || 0 })));
            // Read totalItems from session document
            let totalItems = null;
            let totalPages = null;
            try {
                const sessionDoc = await db.collection(MATCHING_SESSIONS_COLLECTION).doc(sessionId).get();
                if (sessionDoc.exists) {
                    const sessionData = sessionDoc.data();
                    if (sessionData && typeof sessionData.totalItems === "number") {
                        totalItems = sessionData.totalItems;
                        totalPages = Math.ceil(totalItems / perPage);
                    }
                }
            }
            catch (error) {
                logger.warn("Failed to read totalItems from matching session", { error, sessionId });
            }
            // Check if next page exists
            let nextPage = null;
            const nextPageDealScoreMap = await getMatchingDealIdsForPage(sessionId, page + 1);
            if (nextPageDealScoreMap && nextPageDealScoreMap.size > 0) {
                nextPage = page + 1;
            }
            return {
                sessionId: sessionId,
                items: dealsWithScores,
                curPage: page,
                nextPage: nextPage,
                prevPage: page > 1 ? page - 1 : null,
                total: totalItems,
                perPage,
                totalPages: totalPages,
            };
        }
        else {
            // Session not found or page not found - fall through to create new session
            logger.info("Matching session or page not found, creating new session", {
                sessionId,
                page,
            });
            sessionId = undefined;
        }
    }
    // No session or session not found - create new session with calculated scores
    // Set timeout for database query
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error("Database query timeout after 50 seconds"));
        }, 50000);
    });
    // Fetch ALL matching deals first (set large perPage to get all deals)
    // We need to fetch all deals to calculate scores, then sort and paginate
    const filtersForAllDeals = Object.assign(Object.assign({}, filters), { page: 1, perPage: 1000 });
    const priorityFieldFilters = buildProfilePriorityFilters(consumerProfile, filters, colorCache, bodyCache, wheelDriveCache);
    const filtersForMatchingFetch = Object.assign(Object.assign(Object.assign({}, filtersForAllDeals), priorityFieldFilters), { _debugProfileId: profileId });
    logger.info("Applying priority filters for matching fetch", {
        profileId,
        priorityFilters: priorityFieldFilters,
    });
    if (isDebugProfile) {
        logger.info("Matching filter formation details", {
            profileId,
            baseFilters: filtersForAllDeals,
            profilePriorityFilters: priorityFieldFilters,
            finalFiltersForFetch: filtersForMatchingFetch,
        });
    }
    const dealsPromise = (0, deals_js_1.getDeals)(filtersForMatchingFetch, consumerId, favoritedDealIds, false, true); // Use PlanetScale for matching API
    const deals = await Promise.race([dealsPromise, timeoutPromise]);
    logger.info("Matching deals fetched before scoring", {
        profileId,
        fetchedCount: deals.items.length,
        curPage: deals.curPage,
        nextPage: deals.nextPage,
        total: deals.total,
    });
    if (isDebugProfile) {
        logger.info("Matching fetched deal IDs snapshot", {
            profileId,
            first50DealIds: deals.items.slice(0, 50).map((d) => d.id),
        });
    }
    // Calculate match scores for all deals
    logger.info("Calculating match scores for deals", {
        profileId,
        totalDeals: deals.items.length,
    });
    const dealsWithScores = await Promise.all(deals.items.map(async (deal) => {
        try {
            // Pass colorCache and bodyCache to avoid database queries during score calculation
            const matchResult = await (0, matchScore_js_1.calculateMatchScore)(deal, consumerProfile, colorCache, bodyCache, wheelDriveCache);
            return Object.assign(Object.assign({}, deal), { matchScore: matchResult.score });
        }
        catch (error) {
            logger.error("Error calculating match score", {
                error: error instanceof Error ? error.message : String(error),
                dealId: deal.id,
                profileId,
            });
            // If score calculation fails, assign 0 score
            return Object.assign(Object.assign({}, deal), { matchScore: 0 });
        }
    }));
    // Guard against malformed rows from upstream queries.
    // Firestore rejects undefined values in nested fields (e.g. dealId).
    const validDealsWithScores = dealsWithScores.filter((deal) => (typeof deal.id === "string" && deal.id.trim().length > 0));
    if (validDealsWithScores.length !== dealsWithScores.length) {
        logger.warn("Dropping matching deals with invalid IDs before session write", {
            droppedCount: dealsWithScores.length - validDealsWithScores.length,
            totalBefore: dealsWithScores.length,
            totalAfter: validDealsWithScores.length,
            profileId,
        });
    }
    // Sort deals by match score descending, then by lowest monthly price for same integer score
    validDealsWithScores.sort((a, b) => {
        var _a, _b;
        const scoreDiff = b.matchScore - a.matchScore;
        if (Math.floor(a.matchScore) !== Math.floor(b.matchScore))
            return scoreDiff;
        const priceA = (_a = a.monthly_price) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER;
        const priceB = (_b = b.monthly_price) !== null && _b !== void 0 ? _b : Number.MAX_SAFE_INTEGER;
        return priceA - priceB;
    });
    // Create batches based on perPage (store both dealId and matchScore)
    const batches = {};
    const totalDeals = validDealsWithScores.length;
    const totalPages = Math.ceil(totalDeals / perPage);
    for (let i = 0; i < totalDeals; i += perPage) {
        const batchNumber = Math.floor(i / perPage) + 1;
        const batchDeals = validDealsWithScores.slice(i, i + perPage);
        batches[batchNumber] = batchDeals.map((deal) => ({
            dealId: deal.id,
            matchScore: deal.matchScore,
        }));
    }
    if (isDebugProfile) {
        logger.info("Matching session batching details", {
            profileId,
            totalDealsAfterValidation: totalDeals,
            perPage,
            totalPages,
            batchCount: Object.keys(batches).length,
            firstBatchPreview: ((_a = batches[1]) === null || _a === void 0 ? void 0 : _a.slice(0, 10)) || [],
        });
    }
    // Generate session ID if not provided
    if (!sessionId) {
        sessionId = (0, crypto_1.randomUUID)();
    }
    // Store session in Firestore
    await createMatchingSessionWithPages(sessionId, batches, totalDeals);
    logger.info("Matching session created", {
        sessionId,
        profileId,
        totalBatches: Object.keys(batches).length,
        totalDeals,
    });
    // Get deals for the requested page (already includes match scores)
    const pageDeals = batches[page] || [];
    const pageDealIds = pageDeals.map((d) => d.dealId);
    if (pageDealIds.length > 0) {
        const dealsWithFavourites = await (0, dealFormatters_js_1.fetchAndFormatDeals)(pageDealIds, consumerId);
        // Use stored match scores from batches (no recalculation needed)
        const dealScoreMap = new Map(pageDeals.map((d) => [d.dealId, d.matchScore]));
        const itemsWithScores = dealsWithFavourites.map((deal) => (Object.assign(Object.assign({}, deal), { matchScore: dealScoreMap.get(deal.id) || 0 })));
        return {
            sessionId: sessionId,
            items: itemsWithScores,
            curPage: page,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
            total: totalDeals,
            perPage,
            totalPages,
        };
    }
    else {
        return {
            sessionId: sessionId,
            items: [],
            curPage: page,
            nextPage: null,
            prevPage: page > 1 ? page - 1 : null,
            total: totalDeals,
            perPage,
            totalPages,
        };
    }
}
//# sourceMappingURL=matching.js.map