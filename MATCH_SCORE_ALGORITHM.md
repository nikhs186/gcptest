# Match Score Algorithm Explanation

## Overview

The match score algorithm calculates a compatibility score (0-100) between a consumer profile and a deal/car combination. The score indicates how well a deal matches a consumer's preferences based on weighted priority levels.

## Priority System

### Default Priority Levels

1. **Highest Priority (40% weight)**
   - `monthly_price`: Monthly lease payment range
   - `deposit`: Initial deposit amount range
   - `mileage`: Deal mileage allowance range
   - `lease_period`: Lease duration range

2. **Second Priority (35% weight)**
   - `car_mileage`: Car's current mileage
   - `fuel`: Fuel type (petrol, diesel, electric, etc.)
   - `transmission`: Transmission type (manual, automatic)
   - `color`: Car color preference
   - `body`: Car body type

3. **Third Priority (25% weight)**
   - `tax_class`: Tax classification (passenger, van)
   - `weight`: Vehicle weight range
   - `horsepower`: Engine power range
   - `batterycap`: Battery capacity (for electric vehicles)
   - `battery_range`: Battery range (for electric vehicles)
   - `specs`: Car specifications array
   - `inclusion`: Deal inclusions array

### Priority Shifting Rule

**Important**: If any lower priority field has `priority = 1` in the consumer profile, that field is automatically promoted to **Highest Priority** level, regardless of its default category.

Example:
- If `fuel` (normally Second Priority) has `priority = 1` in profile, it becomes Highest Priority
- If `specs` (normally Third Priority) has `priority = 1` in profile, it becomes Highest Priority

## Algorithm Steps

### Step 1: Field Matching

For each field, calculate an individual match score (0-100):

#### Range-Based Fields (monthly_price, deposit, mileage, lease_period, weight, horsepower, batterycap)

```typescript
if (dealValue is within [profileMin, profileMax]) {
  score = 100  // Perfect match
} else {
  score = 0    // No match
}
```

**Example:**
- Profile: `monthly_price: {min: 5000, max: 10000, priority: 1}`
- Deal: `monthly_price: 7500`
- Result: ✅ Match (7500 is within 5000-10000) → Score: 100

#### Array-Based Fields (fuel, transmission, color, body, tax_class)

For fields with multiple preferences and priorities:

```typescript
For each profile preference:
  weight = 11 - priority  // Priority 1 = weight 10, Priority 2 = weight 9, etc.
  if (dealValue matches profileValue):
    totalScore += weight
  maxPossibleScore += weight

finalScore = (totalScore / maxPossibleScore) * 100
```

**Example:**
- Profile: `fuel: [{fuel: "electric", priority: 1}, {fuel: "hybrid-petrol", priority: 2}]`
- Deal: `car.fuel: "electric"`
- Calculation:
  - Electric (priority 1, weight 10): ✅ Match → +10
  - Hybrid-petrol (priority 2, weight 9): ❌ No match → +0
  - Total: 10 / 19 = 52.6% → Score: 52.6

#### Number Array Fields (specs, inclusion)

Similar to array-based fields, but matches deal array values against profile preferences:

```typescript
For each profile preference:
  weight = 11 - priority
  if (profileValue exists in dealArray):
    totalScore += weight
  maxPossibleScore += weight

finalScore = (totalScore / maxPossibleScore) * 100
```

**Example:**
- Profile: `specs: [{specs: 101, priority: 1}, {specs: 202, priority: 2}]`
- Deal: `car.spec: [101, 303, 404]`
- Calculation:
  - Spec 101 (priority 1, weight 10): ✅ Match → +10
  - Spec 202 (priority 2, weight 9): ❌ No match → +0
  - Total: 10 / 19 = 52.6% → Score: 52.6

### Step 2: Priority Group Scoring

Group all field scores by their effective priority level and calculate weighted averages:

```typescript
highestScore = average of all Highest Priority field scores
secondScore = average of all Second Priority field scores
thirdScore = average of all Third Priority field scores
```

### Step 3: Final Score Calculation

Combine priority-level scores using priority weights:

```typescript
finalScore = (
  highestScore * 0.40 +  // 40% weight
  secondScore * 0.35 +   // 35% weight
  thirdScore * 0.25      // 25% weight
)
```

**Example:**
- Highest Priority average: 85%
- Second Priority average: 70%
- Third Priority average: 60%
- Final Score: (85 × 0.40) + (70 × 0.35) + (60 × 0.25) = 34 + 24.5 + 15 = **73.5**

## Missing Data Handling

The algorithm tracks missing data in both deal and profile:

- If a field is missing in the deal: Score = 0, added to `missingData` array
- If a field is missing in the profile: Score = 0, added to `missingData` array

Missing data doesn't prevent score calculation but reduces the maximum possible score for that field.

## Score Interpretation

- **90-100**: Excellent match - Deal closely matches all high-priority preferences
- **70-89**: Good match - Deal matches most preferences with minor gaps
- **50-69**: Moderate match - Deal matches some preferences but misses others
- **30-49**: Poor match - Deal has significant gaps in preferences
- **0-29**: Very poor match - Deal doesn't match most preferences

## Example Calculation

### Consumer Profile:
```json
{
  "monthly_price": { "min": 5000, "max": 10000, "priority": 1 },
  "deposit": { "min": 10000, "max": 20000, "priority": 2 },
  "fuel": [
    { "fuel": "electric", "priority": 1 },
    { "fuel": "hybrid-petrol", "priority": 2 }
  ],
  "transmission": [
    { "transmission": "automatic", "priority": 1 }
  ],
  "specs": [
    { "specs": 101, "priority": 1 },
    { "specs": 202, "priority": 3 }
  ]
}
```

### Deal:
```json
{
  "monthly_price": 7500,
  "deposit": 15000,
  "car": {
    "fuel": "electric",
    "transmission": "automatic",
    "spec": [101, 303]
  }
}
```

### Calculation:

1. **monthly_price**: 7500 in [5000, 10000] → ✅ 100% (Highest Priority)
2. **deposit**: 15000 in [10000, 20000] → ✅ 100% (Highest Priority)
3. **fuel**: Electric matches (priority 1) → ✅ 100% (Highest Priority, shifted from Second)
4. **transmission**: Automatic matches (priority 1) → ✅ 100% (Highest Priority, shifted from Second)
5. **specs**: Spec 101 matches (priority 1) → ✅ 100% (Highest Priority, shifted from Third)

**Priority Group Scores:**
- Highest Priority: (100 + 100 + 100 + 100 + 100) / 5 = 100%

**Final Score:**
- 100 × 0.40 = **40.0** (only Highest Priority fields present)

Note: Since all matched fields were shifted to Highest Priority, the final score reflects only that priority level.

## Implementation Notes

1. **Priority Shifting**: Checked first before calculating scores
2. **Weight Calculation**: Uses inverse priority (lower priority number = higher weight)
3. **Array Matching**: Supports multiple preferences with different priorities
4. **Range Matching**: Binary match (in range or not) - could be enhanced with distance-based scoring
5. **Missing Data**: Tracked separately for debugging and transparency

## Usage

```typescript
import { calculateMatchScore } from "./helpers/matchScore";

const result = calculateMatchScore(deal, consumerProfile);

console.log(`Match Score: ${result.score}/100`);
console.log(`Missing Data: ${result.missingData.join(", ")}`);
result.breakdown.forEach(field => {
  console.log(`${field.field}: ${field.score}% (${field.priority} priority)`);
});
```

