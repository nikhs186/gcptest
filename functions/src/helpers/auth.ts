import * as logger from "firebase-functions/logger";
import {Request} from "express";
import {executeQuery} from "./pg";

/**
 * Extracts Bearer token from Authorization header
 * @param {Request} req Express request object
 * @return {string | null} Bearer token or null if not found
 */
export const extractBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
};

/**
 * Validates Bearer token with Xano API and returns user email
 * @param {string} token Bearer token
 * @return {Promise<{email: string} | null>} User email or null if validation fails
 */
export const validateToken = async (token: string): Promise<{email: string} | null> => {
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
      let responseBody: string | unknown = null;
      try {
        responseBody = await response.text();
        // Try to parse as JSON if possible
        try {
          responseBody = JSON.parse(responseBody as string);
        } catch {
          // Keep as text if not valid JSON
        }
      } catch {
        // Ignore errors reading response body
      }

      logger.warn("Token validation failed - Auth API returned error", {
        status: response.status,
        statusText: response.statusText,
        response: responseBody,
      });
      return null;
    }

    const data = await response.json() as {email?: string};
    if (!data.email) {
      logger.warn("Email not found in token validation response", {
        response: data,
      });
      return null;
    }

    return {email: data.email};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error validating token", {error: errorMessage});
    return null;
  }
};

/**
 * Gets consumer_id from x1_2 table by email
 * @param {string} email User email
 * @return {Promise<string | null>} Consumer ID (uuid) or null if not found
 */
export const getConsumerIdByEmail = async (email: string): Promise<string | null> => {
  try {
    // Query to find consumer in x1_2 table by email
    // x1_2 table has direct email column (not in xdo JSONB)
    const query = `
      SELECT id
      FROM public.x1_2
      WHERE email = $1
      LIMIT 1
    `;

    const result = await executeQuery(query, [email]);
    if (result.rows.length > 0) {
      const consumerId = result.rows[0].id as string;
      logger.info("Consumer record found", {email, consumerId});
      return consumerId;
    }

    logger.info("Consumer record not found", {email});
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching consumer by email", {error: errorMessage, email});
    return null;
  }
};

/**
 * Gets all favorited deal IDs for a consumer from x1_69 table
 * @param {string} consumerId Consumer UUID
 * @return {Promise<string[]>} Array of favorited deal IDs
 */
export const getAllFavoritedDealIds = async (consumerId: string): Promise<string[]> => {
  try {
    const query = `
      SELECT deal_id
      FROM public.x1_69
      WHERE consumer_id = $1::uuid
    `;

    const result = await executeQuery(query, [consumerId]);
    const favoritedIds = result.rows.map((row) => row.deal_id as string);
    return favoritedIds;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching all favorited deals", {error: errorMessage, consumerId});
    return [];
  }
};

/**
 * Gets favorited deal IDs for a consumer from x1_69 table
 * @param {string} consumerId Consumer UUID
 * @param {string[]} dealIds Array of deal IDs to check
 * @return {Promise<Set<string>>} Set of favorited deal IDs
 */
export const getFavoritedDealIds = async (
  consumerId: string,
  dealIds: string[],
): Promise<Set<string>> => {
  if (dealIds.length === 0) {
    return new Set<string>();
  }

  try {
    const query = `
      SELECT deal_id
      FROM public.x1_69
      WHERE consumer_id = $1::uuid
        AND deal_id = ANY($2::uuid[])
    `;

    const result = await executeQuery(query, [consumerId, dealIds]);
    const favoritedIds = new Set<string>();
    result.rows.forEach((row) => {
      favoritedIds.add(row.deal_id as string);
    });

    return favoritedIds;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching favorited deals", {error: errorMessage, consumerId});
    return new Set<string>();
  }
};

