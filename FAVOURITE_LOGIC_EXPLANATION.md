# Favourite Logic Explanation

This document explains how the favourite/deal favoriting system works in the marketplace API.

## Overview

The favourite functionality has **two modes**:
1. **Filter mode**: Return ONLY favorited deals (`favourite=true` parameter)
2. **Display mode**: Return all deals with a `favourite` field indicating if each deal is favorited

---

## 🔄 Flow Diagram

```
API Request
    ↓
[1] Extract Bearer Token
    ↓
[2] Validate Token → Get Email
    ↓
[3] Get Consumer ID from x1_2 table
    ↓
[4] Check for "favourite" parameter
    ↓
[5a] If favourite=true → Get ALL favorited deal IDs → Filter deals
[5b] If no favourite param → Get deals normally
    ↓
[6] For each deal, check if favorited → Add favourite field
    ↓
Response with deals + favourite field
```

---

## 📝 Step-by-Step Code Explanation

### **STEP 1: API Route Handler** (`routes.ts`)

#### 1.1 Extract and Validate Bearer Token

```typescript:32-54:functions/src/api/marketplace/routes.ts
// Handle Bearer token authorization
let consumerId: string | null = null;
const token = extractBearerToken(req);

if (token) {
  logger.info("Authorization token is valid");

  // Validate token with Xano API
  const userData = await validateToken(token);
  if (userData && userData.email) {
    logger.info("Token validated successfully", {email: userData.email});

    // Search for consumer in x1_2 table by email
    consumerId = await getConsumerIdByEmail(userData.email);
    if (consumerId) {
      logger.info("Consumer record found", {email: userData.email, consumerId});
    } else {
      logger.info("Consumer record not found", {email: userData.email});
    }
  } else {
    logger.warn("Token validation failed or no email returned");
  }
}
```

**What happens:**
- Extracts Bearer token from `Authorization: Bearer <token>` header
- Calls Xano API to validate token and get user email
- Looks up consumer ID in `x1_2` table using email
- Stores `consumerId` for later use

**Database Tables:**
- `x1_2`: Consumer table with `id` (UUID) and `email` columns

---

#### 1.2 Check for Favourite Filter Parameter

```typescript:56-90:functions/src/api/marketplace/routes.ts
// Check for favourite filter in query params or data field
const query = req.query;
let favouriteFilter = false;

// Check in query params first
if (query.favourite !== undefined) {
  const favouriteValue = String(query.favourite).toLowerCase();
  favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
}

// Check in data field if present
if (!favouriteFilter && query.data) {
  try {
    let dataValue: unknown;
    if (typeof query.data === "string") {
      dataValue = JSON.parse(query.data);
    } else {
      dataValue = query.data;
    }

    if (dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)) {
      const dataObj = dataValue as Record<string, unknown>;
      if (dataObj.favourite !== undefined) {
        if (typeof dataObj.favourite === "boolean") {
          favouriteFilter = dataObj.favourite;
        } else {
          const favouriteValue = String(dataObj.favourite).toLowerCase();
          favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
        }
      }
    }
  } catch {
    // Ignore parsing errors
  }
}
```

**What happens:**
- Checks for `favourite` parameter in two places:
  1. Direct query parameter: `?favourite=true`
  2. Inside `data` JSON field: `?data={"favourite":true}`
- Sets `favouriteFilter = true` if found

**Example requests:**
- `GET /marketplace/deals?favourite=true`
- `GET /marketplace/deals?data={"favourite":true}`

---

#### 1.3 Handle Favourite Filter (FILTER MODE)

```typescript:92-102:functions/src/api/marketplace/routes.ts
// Handle favourites filter - only return favorited deals
let favoritedDealIds: string[] | null = null;
if (favouriteFilter) {
  if (!consumerId) {
    logger.warn("Favourite filter requested but no valid consumer found - returning empty results");
    favoritedDealIds = []; // Empty array to return no results
  } else {
    favoritedDealIds = await getAllFavoritedDealIds(consumerId);
    logger.info("Favourites found", {count: favoritedDealIds.length, consumerId});
  }
}
```

**What happens:**
- If `favouriteFilter = true`:
  - Gets ALL favorited deal IDs for the consumer from `x1_69` table
  - Stores in `favoritedDealIds` array
  - Logs how many favorites were found
- If no `consumerId`: Returns empty array (no results)

**Database Query:**
```sql
SELECT deal_id
FROM public.x1_69
WHERE consumer_id = $1::uuid
```

**Database Table:**
- `x1_69`: Favourites table with structure:
  - `id` (integer)
  - `created_at` (timestamp)
  - `deal_id` (uuid)
  - `consumer_id` (uuid)

---

#### 1.4 Call getDeals Function

```typescript:112:functions/src/api/marketplace/routes.ts
// Execute the query with timeout, passing consumerId and favoritedDealIds
const dealsPromise = getDeals(filters, consumerId, favoritedDealIds);
```

**Parameters passed:**
- `filters`: Regular deal filters (price, make, model, etc.)
- `consumerId`: For adding `favourite` field to each deal
- `favoritedDealIds`: If provided, only return these deals (FILTER MODE)

---

### **STEP 2: Build WHERE Clause** (`deals.ts`)

#### 2.1 Filter by Favorited Deal IDs (FILTER MODE)

```typescript:21-29:functions/src/helpers/deals.ts
// Filter by favorited deal IDs if provided
if (favoritedDealIds !== null && favoritedDealIds.length > 0) {
  conditions.push(`d.id = ANY($${paramIndex}::uuid[])`);
  params.push(favoritedDealIds);
  paramIndex++;
} else if (favoritedDealIds !== null && favoritedDealIds.length === 0) {
  // If favoritedDealIds is an empty array, return no results
  conditions.push("1 = 0");
}
```

**What happens:**
- If `favoritedDealIds` is provided and has items:
  - Adds SQL condition: `d.id = ANY([array of deal IDs])`
  - Only deals matching these IDs will be returned
- If `favoritedDealIds` is empty array:
  - Adds condition: `1 = 0` (always false)
  - Returns no deals (user has no favorites)

**SQL Generated:**
```sql
WHERE d.xdo->>'status' = 'active'
  AND d.id = ANY(ARRAY['uuid1', 'uuid2', 'uuid3']::uuid[])
```

---

#### 2.2 Sorting for Favorites

```typescript:452-460:functions/src/helpers/deals.ts
// When location filter is provided, sort by distance ASC
// But if favorites are also filtered, prioritize created_at DESC
if (favoritedDealIds !== null) {
  // Favorites filtered: sort by created_at DESC
  orderByClause = "ORDER BY to_timestamp((d.xdo->>'created_at')::numeric / 1000.0) DESC";
} else {
  // No favorites: sort by distance ASC
  orderByClause = "ORDER BY distance ASC";
}
```

**What happens:**
- When favorites are filtered, always sort by `created_at DESC`
- This ensures newest favorited deals appear first

---

### **STEP 3: Add Favourite Field to Each Deal** (DISPLAY MODE)

#### 3.1 Check Which Deals Are Favorited

```typescript:1045-1050:functions/src/helpers/deals.ts
// Get favorited deal IDs if consumer_id is provided
let favoritedDealIds = new Set<string>();
if (consumerId && deals.length > 0) {
  const dealIds = deals.map((deal) => deal.id);
  favoritedDealIds = await getFavoritedDealIds(consumerId, dealIds);
}
```

**What happens:**
- After fetching deals from database
- Gets list of all deal IDs that were returned
- Checks which of these are favorited by the consumer
- Creates a `Set` of favorited deal IDs for fast lookup

**Database Query:**
```sql
SELECT deal_id
FROM public.x1_69
WHERE consumer_id = $1::uuid
  AND deal_id = ANY($2::uuid[])
```

**Note:** This is different from `getAllFavoritedDealIds`:
- `getAllFavoritedDealIds`: Gets ALL favorites (used for FILTER MODE)
- `getFavoritedDealIds`: Gets favorites from a specific list (used for DISPLAY MODE)

---

#### 3.2 Add Favourite Field to Each Deal

```typescript:1052-1056:functions/src/helpers/deals.ts
// Add favourite field to each deal
const dealsWithFavourites = deals.map((deal) => ({
  ...deal,
  favourite: consumerId ? favoritedDealIds.has(deal.id) : false,
}));
```

**What happens:**
- Maps over each deal
- Adds `favourite: true/false` field
- If `consumerId` exists: Check if deal ID is in the favorites Set
- If no `consumerId`: Always set `favourite: false`

**Example Response:**
```json
{
  "items": [
    {
      "id": "uuid-1",
      "monthly_price": 5000,
      "favourite": true  // ← This deal is favorited
    },
    {
      "id": "uuid-2",
      "monthly_price": 6000,
      "favourite": false  // ← This deal is NOT favorited
    }
  ]
}
```

---

## 🎯 Two Modes Summary

### **Mode 1: FILTER MODE** (`favourite=true`)
**Purpose:** Return ONLY favorited deals

**Flow:**
1. Get ALL favorited deal IDs for consumer
2. Filter database query to only return those deals
3. Sort by `created_at DESC`
4. Add `favourite: true` to all returned deals

**Example Request:**
```
GET /marketplace/deals?favourite=true
Authorization: Bearer <token>
```

**Example Response:**
```json
{
  "items": [
    {
      "id": "uuid-1",
      "monthly_price": 5000,
      "favourite": true
    },
    {
      "id": "uuid-3",
      "monthly_price": 7000,
      "favourite": true
    }
  ],
  "total": 2  // Only 2 favorites
}
```

---

### **Mode 2: DISPLAY MODE** (no `favourite` parameter)
**Purpose:** Return all deals with `favourite` field indicating status

**Flow:**
1. Fetch all deals normally (with any other filters)
2. Check which of these deals are favorited
3. Add `favourite: true/false` field to each deal

**Example Request:**
```
GET /marketplace/deals
Authorization: Bearer <token>
```

**Example Response:**
```json
{
  "items": [
    {
      "id": "uuid-1",
      "monthly_price": 5000,
      "favourite": true   // Favorited
    },
    {
      "id": "uuid-2",
      "monthly_price": 6000,
      "favourite": false  // Not favorited
    },
    {
      "id": "uuid-3",
      "monthly_price": 7000,
      "favourite": true   // Favorited
    }
  ],
  "total": 100  // All deals
}
```

---

## 🔑 Key Points

1. **Authentication Required:**
   - Bearer token is validated via Xano API
   - Consumer ID is fetched from `x1_2` table
   - Without valid token/consumer, `favourite` field is always `false`

2. **Database Tables:**
   - `x1_2`: Consumer table (`id`, `email`)
   - `x1_69`: Favourites table (`id`, `created_at`, `deal_id`, `consumer_id`)

3. **Performance:**
   - FILTER MODE: Single query to get all favorites, then filters
   - DISPLAY MODE: Single query to check favorites for returned deals (using `ANY` operator)

4. **Edge Cases:**
   - No token → `favourite: false` for all deals
   - No consumer found → Empty results if `favourite=true`
   - No favorites → Empty results if `favourite=true`
   - Favorites exist but none match filters → Empty results

5. **Sorting:**
   - Favorites are always sorted by `created_at DESC` (newest first)



