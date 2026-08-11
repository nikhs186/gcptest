"use strict";
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
exports.getFavoritedDealIds = exports.getAllFavoritedDealIds = exports.getConsumerIdByEmail = exports.validateToken = exports.extractBearerToken = void 0;
const logger = __importStar(require("../logger"));
const pg_1 = require("./pg");
/**
 * Extracts Bearer token from Authorization header
 * @param {Request} req Express request object
 * @return {string | null} Bearer token or null if not found
 */
const extractBearerToken = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    return authHeader.substring(7); // Remove "Bearer " prefix
};
exports.extractBearerToken = extractBearerToken;
/**
 * Validates Bearer token with Xano API and returns user email
 * @param {string} token Bearer token
 * @return {Promise<{email: string} | null>} User email or null if validation fails
 */
const validateToken = async (token) => {
    try {
        const apiUrl = new URL("https://xnsc-n94p-ixz6.e2.xano.io/api:Hldls9bu/user");
        apiUrl.searchParams.append("user_type", "consumer");
        const response = await fetch(apiUrl.toString(), {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            // Try to get response body for logging
            let responseBody = null;
            try {
                responseBody = await response.text();
                // Try to parse as JSON if possible
                try {
                    responseBody = JSON.parse(responseBody);
                }
                catch (_a) {
                    // Keep as text if not valid JSON
                }
            }
            catch (_b) {
                // Ignore errors reading response body
            }
            logger.warn("Token validation failed - Auth API returned error", {
                status: response.status,
                statusText: response.statusText,
                response: responseBody,
            });
            return null;
        }
        const data = await response.json();
        if (!data.email) {
            logger.warn("Email not found in token validation response", {
                response: data,
            });
            return null;
        }
        return { email: data.email };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error validating token", { error: errorMessage });
        return null;
    }
};
exports.validateToken = validateToken;
/**
 * Gets consumer_id from x1_2 table by email
 * @param {string} email User email
 * @return {Promise<string | null>} Consumer ID (uuid) or null if not found
 */
const getConsumerIdByEmail = async (email) => {
    try {
        // Query to find consumer in x1_2 table by email
        // x1_2 table has direct email column (not in xdo JSONB)
        const query = `
      SELECT id
      FROM public.x1_2
      WHERE email = $1
      LIMIT 1
    `;
        const result = await (0, pg_1.executeQuery)(query, [email]);
        if (result.rows.length > 0) {
            const consumerId = result.rows[0].id;
            logger.info("Consumer record found", { email, consumerId });
            return consumerId;
        }
        logger.info("Consumer record not found", { email });
        return null;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error fetching consumer by email", { error: errorMessage, email });
        return null;
    }
};
exports.getConsumerIdByEmail = getConsumerIdByEmail;
/**
 * Gets all favorited deal IDs for a consumer from x1_69 table
 * @param {string} consumerId Consumer UUID
 * @return {Promise<string[]>} Array of favorited deal IDs
 */
const getAllFavoritedDealIds = async (consumerId) => {
    try {
        const query = `
      SELECT deal_id
      FROM public.x1_69
      WHERE consumer_id = $1::uuid
    `;
        const result = await (0, pg_1.executeQuery)(query, [consumerId]);
        const favoritedIds = result.rows.map((row) => row.deal_id);
        return favoritedIds;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error fetching all favorited deals", { error: errorMessage, consumerId });
        return [];
    }
};
exports.getAllFavoritedDealIds = getAllFavoritedDealIds;
/**
 * Gets favorited deal IDs for a consumer from x1_69 table
 * @param {string} consumerId Consumer UUID
 * @param {string[]} dealIds Array of deal IDs to check
 * @return {Promise<Set<string>>} Set of favorited deal IDs
 */
const getFavoritedDealIds = async (consumerId, dealIds) => {
    if (dealIds.length === 0) {
        return new Set();
    }
    try {
        const query = `
      SELECT deal_id
      FROM public.x1_69
      WHERE consumer_id = $1::uuid
        AND deal_id = ANY($2::uuid[])
    `;
        const result = await (0, pg_1.executeQuery)(query, [consumerId, dealIds]);
        const favoritedIds = new Set();
        result.rows.forEach((row) => {
            favoritedIds.add(row.deal_id);
        });
        return favoritedIds;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error fetching favorited deals", { error: errorMessage, consumerId });
        return new Set();
    }
};
exports.getFavoritedDealIds = getFavoritedDealIds;
//# sourceMappingURL=auth.js.map