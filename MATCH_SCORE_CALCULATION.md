# Match Score Calculation Documentation

## Overview

The match score algorithm calculates a compatibility score (0-99) between a **Deal** and a **ConsumerProfile**. The score represents how well a deal matches a user's preferences, with 99 being a perfect match.

## Algorithm Structure

### Priority System

The algorithm uses a **three-tier priority system** with different weights:

| Priority Level | Weight | Percentage of Total Score |
|---------------|--------|---------------------------|
| **HIGHEST**    | 10     | 40%                        |
| **SECOND**     | 7      | 35%                        |
| **THIRD**      | 3.5    | 25%                        |

### Priority Shifting Rule

**Important**: If any field in the profile has `priority = 1`, that field is automatically promoted to **HIGHEST** priority, regardless of its default priority level.

## Standard Fields (1-18)

### Highest Priority Fields (Weight: 10, 40% of score)

#### 1. Monthly Price
- **Type**: Range match with price bonus
- **Scoring**: 
  - If deal price is within profile range → Score: 95-100 (lower prices get higher scores)
  - If outside range → Score: 0
- **Example**: 
  - Profile: `[0, 10000]`
  - Deal: `7000` → Score: **98.6** (lower price bonus)
  - Deal: `9000` → Score: **98.2** (slightly lower bonus)

#### 2. Deposit
- **Type**: Range match with price bonus
- **Scoring**: Same as monthly_price (95-100 for matches, 0 for no match)

#### 3. Mileage (Deal)
- **Type**: "Higher is better" range match
- **Scoring**: 
  - If `deal.mileage >= profile.min` → Score: 100 (even if exceeds max)
  - Otherwise → Score: 0
- **Example**:
  - Profile: `[0, 16000]`
  - Deal: `50000` → Score: **100** (higher is better, so it matches)

#### 4. Lease Period
- **Type**: Range match
- **Scoring**: 100 if in range, 0 if not

### Second Priority Fields (Weight: 7, 35% of score)

#### 5. Car Mileage
- **Type**: "Higher is better" range match (uses same profile.mileage field)

#### 6. Make
- **Type**: ID array match
- **Scoring**: 100% if any make ID matches, 0% if none
- **Example**:
  - Profile: `[{make: 1, priority: 2}, {make: 5, priority: 3}]`
  - Deal: `make_id: 1` → Score: **100**

#### 7. Model
- **Type**: ID array match
- **Scoring**: 100% if any model ID matches, 0% if none

#### 8. Fuel
- **Type**: String array match
- **Scoring**: 100% if any fuel type matches, 0% if none
- **Example**:
  - Profile: `[{fuel: "electric", priority: 2}, {fuel: "diesel", priority: 3}]`
  - Deal: `fuel: "electric"` → Score: **100**

#### 9. Transmission
- **Type**: String array match
- **Scoring**: 100% if any transmission matches, 0% if none

#### 10. Color
- **Type**: Name lookup match (profile uses color IDs, looks up names from database)
- **Scoring**: 100% if any color matches, 0% if none

#### 11. Body
- **Type**: Code lookup match (profile uses body IDs, looks up codes from database)
- **Scoring**: 100% if any body matches, 0% if none

### Third Priority Fields (Weight: 3.5, 25% of score)

#### 12. Tax Class
- **Type**: String array match
- **Scoring**: 100% if any matches, 0% if none

#### 13-16. Weight, Horsepower, Battery Capacity, Battery Range
- **Type**: Range match
- **Scoring**: 100 if in range, 0 if not

#### 17. Specs
- **Type**: Number array match (weighted)
- **Scoring**: Weighted percentage based on how many spec IDs match
- **Example**:
  - Profile: `[{specs: 1, priority: 2}, {specs: 2, priority: 3}, {specs: 3, priority: 4}]`
  - Deal: `spec: [1, 2]`
  - Matches: spec 1 (weight 9) + spec 2 (weight 8) = 17
  - Max possible: 9 + 8 + 7 = 24
  - Score: **(17 / 24) × 100 = 70.8%**

#### 18. Inclusion
- **Type**: Number array match (weighted)
- **Scoring**: Same weighted calculation as specs

## PriorityList from Data Field (Field 19)

### Overview

If `profile.data.priorityList` exists, it contains user-ordered preferences with **dynamic weights** based on array position.

### Weight Calculation

Weights decrease by 1 for each index:
- **Index 0**: Weight = **10** (highest)
- **Index 1**: Weight = **9**
- **Index 2**: Weight = **8**
- **Index 3**: Weight = **7**
- And so on...

### Supported Fields

PriorityList can contain these field types:

| Field Name      | Value Type        | Matching Logic                    |
|-----------------|-------------------|-----------------------------------|
| `fuel`          | String            | Exact match                       |
| `tax_class`     | String            | Exact match                       |
| `body`           | String            | Exact match                       |
| `color`          | String            | Exact match                       |
| `monthly_price`  | Array `[min, max]`| Range match                       |
| `deposit`        | Array `[min, max]`| Range match                       |
| `lease_period`   | Array `[min, max]`| Range match                       |
| `mileage`        | Array `[min, max]`| Higher is better (>= min)         |
| `inclusion`      | Number            | ID match in inclusion array        |
| `specs`          | Number            | ID match in spec array            |
| `seat`           | Number            | Exact match                       |

### PriorityList Scoring

- All PriorityList items use **HIGHEST priority level** (40% weight)
- Each item gets its own **dynamic weight** (10, 9, 8, ...)
- Contribution: `score × itemWeight × 0.40`

## Final Score Calculation

### Formula

```
finalScore = (totalWeightedScore / totalMaxPossibleScore) × 99
```

Where:
- `totalWeightedScore` = Sum of all `fieldScore × fieldWeight × priorityWeight`
- `totalMaxPossibleScore` = Sum of all `100 × fieldWeight × priorityWeight`
- Result is **capped at 99** and rounded to 2 decimal places

### Key Points

1. **Only fields present in profile** are included in calculation
2. **Missing deal fields** don't reduce score (they're just marked as missing)
3. **Priority shifting** promotes fields with `priority = 1` to HIGHEST
4. **Price bonus** gives slightly higher scores to lower prices within range

## Examples

### Example 1: Basic Match

**Profile:**
```json
{
  "monthly_price": {"min": 0, "max": 10000, "priority": 2},
  "fuel": [{"fuel": "electric", "priority": 2}],
  "color": [{"color": 1, "priority": 3}]
}
```

**Deal:**
```json
{
  "monthly_price": 8000,
  "car": {
    "fuel": "electric",
    "color": "blue"  // Color ID 1 = "blue"
  }
}
```

**Calculation:**

1. **monthly_price** (HIGHEST, weight 10):
   - Score: 98.5 (within range, lower price bonus)
   - Weighted: `98.5 × 10 × 0.40 = 394`
   - Max: `100 × 10 × 0.40 = 400`

2. **fuel** (SECOND, weight 7):
   - Score: 100 (matches)
   - Weighted: `100 × 7 × 0.35 = 245`
   - Max: `100 × 7 × 0.35 = 245`

3. **color** (SECOND, weight 7):
   - Score: 100 (matches)
   - Weighted: `100 × 7 × 0.35 = 245`
   - Max: `100 × 7 × 0.35 = 245`

**Total:**
- `totalWeightedScore = 394 + 245 + 245 = 884`
- `totalMaxPossibleScore = 400 + 245 + 245 = 890`
- `finalScore = (884 / 890) × 99 = 98.3`

---

### Example 2: Priority Shifting

**Profile:**
```json
{
  "monthly_price": {"min": 0, "max": 15000, "priority": 1},  // priority = 1!
  "fuel": [{"fuel": "electric", "priority": 2}]
}
```

**Deal:**
```json
{
  "monthly_price": 12000,
  "car": {"fuel": "electric"}
}
```

**Calculation:**

1. **monthly_price** (HIGHEST due to priority=1, weight 10):
   - Score: 98.0 (within range)
   - Weighted: `98.0 × 10 × 0.40 = 392`
   - Max: `100 × 10 × 0.40 = 400`

2. **fuel** (SECOND, weight 7):
   - Score: 100 (matches)
   - Weighted: `100 × 7 × 0.35 = 245`
   - Max: `100 × 7 × 0.35 = 245`

**Total:**
- `totalWeightedScore = 392 + 245 = 637`
- `totalMaxPossibleScore = 400 + 245 = 645`
- `finalScore = (637 / 645) × 99 = 97.8`

---

### Example 3: PriorityList

**Profile:**
```json
{
  "data": {
    "priorityList": [
      {"name": "fuel", "value": "electric", "priority": "top"},      // Index 0, weight 10
      {"name": "color", "value": "red", "priority": "top"},         // Index 1, weight 9
      {"name": "monthly_price", "value": [0, 10000], "priority": "normal"}  // Index 2, weight 8
    ]
  }
}
```

**Deal:**
```json
{
  "monthly_price": 8000,
  "car": {
    "fuel": "electric",
    "color": "red"
  }
}
```

**Calculation:**

1. **priorityList[0] - fuel** (HIGHEST, weight 10):
   - Score: 100 (matches)
   - Weighted: `100 × 10 × 0.40 = 400`
   - Max: `100 × 10 × 0.40 = 400`

2. **priorityList[1] - color** (HIGHEST, weight 9):
   - Score: 100 (matches)
   - Weighted: `100 × 9 × 0.40 = 360`
   - Max: `100 × 9 × 0.40 = 360`

3. **priorityList[2] - monthly_price** (HIGHEST, weight 8):
   - Score: 98.5 (within range, lower price bonus)
   - Weighted: `98.5 × 8 × 0.40 = 315.2`
   - Max: `100 × 8 × 0.40 = 320`

**Total:**
- `totalWeightedScore = 400 + 360 + 315.2 = 1075.2`
- `totalMaxPossibleScore = 400 + 360 + 320 = 1080`
- `finalScore = (1075.2 / 1080) × 99 = 98.6`

---

### Example 4: Partial Match with Missing Fields

**Profile:**
```json
{
  "monthly_price": {"min": 0, "max": 10000, "priority": 2},
  "fuel": [{"fuel": "electric", "priority": 2}],
  "specs": [{"specs": 1, "priority": 3}, {"specs": 2, "priority": 4}]
}
```

**Deal:**
```json
{
  "monthly_price": 12000,  // Outside range!
  "car": {
    "fuel": "electric",    // Matches
    "spec": [1]            // Matches spec 1 only
  }
}
```

**Calculation:**

1. **monthly_price** (HIGHEST, weight 10):
   - Score: 0 (outside range)
   - Weighted: `0 × 10 × 0.40 = 0`
   - Max: `100 × 10 × 0.40 = 400`

2. **fuel** (SECOND, weight 7):
   - Score: 100 (matches)
   - Weighted: `100 × 7 × 0.35 = 245`
   - Max: `100 × 7 × 0.35 = 245`

3. **specs** (THIRD, weight 3.5):
   - Matches: spec 1 (weight 9) = 9
   - Max possible: spec 1 (weight 9) + spec 2 (weight 8) = 17
   - Score: `(9 / 17) × 100 = 52.9%`
   - Weighted: `52.9 × 3.5 × 0.25 = 46.3`
   - Max: `100 × 3.5 × 0.25 = 87.5`

**Total:**
- `totalWeightedScore = 0 + 245 + 46.3 = 291.3`
- `totalMaxPossibleScore = 400 + 245 + 87.5 = 732.5`
- `finalScore = (291.3 / 732.5) × 99 = 39.4`

**Missing Data:** `["monthly_price"]` (marked as outside range)

---

### Example 5: Complex PriorityList with Standard Fields

**Profile:**
```json
{
  "monthly_price": {"min": 0, "max": 15000, "priority": 2},
  "fuel": [{"fuel": "diesel", "priority": 3}],
  "data": {
    "priorityList": [
      {"name": "fuel", "value": "electric", "priority": "top"},     // Index 0, weight 10
      {"name": "monthly_price", "value": [0, 10000], "priority": "top"}  // Index 1, weight 9
    ]
  }
}
```

**Deal:**
```json
{
  "monthly_price": 8000,
  "car": {"fuel": "electric"}
}
```

**Calculation:**

1. **monthly_price** (standard, HIGHEST, weight 10):
   - Score: 98.5 (within range)
   - Weighted: `98.5 × 10 × 0.40 = 394`
   - Max: `100 × 10 × 0.40 = 400`

2. **fuel** (standard, SECOND, weight 7):
   - Score: 0 (deal is "electric", profile wants "diesel")
   - Weighted: `0 × 7 × 0.35 = 0`
   - Max: `100 × 7 × 0.35 = 245`

3. **priorityList[0] - fuel** (HIGHEST, weight 10):
   - Score: 100 (matches "electric")
   - Weighted: `100 × 10 × 0.40 = 400`
   - Max: `100 × 10 × 0.40 = 400`

4. **priorityList[1] - monthly_price** (HIGHEST, weight 9):
   - Score: 98.5 (within range)
   - Weighted: `98.5 × 9 × 0.40 = 354.6`
   - Max: `100 × 9 × 0.40 = 360`

**Total:**
- `totalWeightedScore = 394 + 0 + 400 + 354.6 = 1148.6`
- `totalMaxPossibleScore = 400 + 245 + 400 + 360 = 1405`
- `finalScore = (1148.6 / 1405) × 99 = 81.0`

**Note:** PriorityList preferences override standard field preferences when they conflict.

---

## Special Cases

### Price Bonus System

For `monthly_price` and `deposit`, lower values within the range get slightly higher scores:

- **Min value in range**: Score = 100
- **Max value in range**: Score = 95
- **Middle values**: Score = 95-100 (proportional)

**Example:**
- Profile: `[0, 10000]`
- Deal: `0` → Score: **100**
- Deal: `5000` → Score: **97.5**
- Deal: `10000` → Score: **95**

### Mileage "Higher is Better"

For mileage fields, if the deal value is **greater than or equal to** the profile minimum, it's considered a match (even if it exceeds the maximum).

**Example:**
- Profile: `[0, 16000]`
- Deal: `50000` → Score: **100** ✅ (higher is better)
- Deal: `10000` → Score: **100** ✅ (within range)
- Deal: `5000` → Score: **100** ✅ (within range)

### Array Matching (Color, Body, Fuel, etc.)

If the profile has multiple options, **any match** gives 100% score:

**Example:**
- Profile: `[{color: 1, priority: 2}, {color: 2, priority: 3}, {color: 3, priority: 4}]`
- Deal: `color: 2` → Score: **100** (one match is enough)

### Weighted Array Matching (Specs, Inclusion)

For specs and inclusion, the score is calculated based on **weighted matches**:

**Example:**
- Profile: `[{specs: 1, priority: 2}, {specs: 2, priority: 3}, {specs: 3, priority: 4}]`
- Deal: `spec: [1, 2]`
- Matched weights: 9 + 8 = 17
- Max possible weights: 9 + 8 + 7 = 24
- Score: **(17 / 24) × 100 = 70.8%**

## Breakdown Structure

Each field contributes to a breakdown array:

```json
{
  "field": "monthly_price",
  "matched": true,
  "score": 98.5,
  "priority": "highest",
  "details": "Value 8000 within range [0, 10000] (lower is better, score: 98.5)"
}
```

PriorityList items have special field names:
```json
{
  "field": "priorityList_fuel_0",
  "matched": true,
  "score": 100,
  "priority": "highest",
  "details": "PriorityList[0]: Matched: electric (weight: 10.00)"
}
```

## Summary

The match score algorithm:

1. ✅ Processes **18 standard fields** with fixed priorities
2. ✅ Processes **PriorityList items** with dynamic weights (10, 9, 8, ...)
3. ✅ Promotes fields with `priority = 1` to HIGHEST
4. ✅ Gives **price bonuses** for lower prices within range
5. ✅ Uses **"higher is better"** logic for mileage
6. ✅ Returns **100% score** for any match in array fields
7. ✅ Calculates **weighted scores** for specs/inclusion
8. ✅ Only includes **fields present in profile**
9. ✅ Caps final score at **99** (not 100)
10. ✅ Provides detailed **breakdown** for debugging

The final score (0-99) represents the overall compatibility between a deal and a consumer profile.

