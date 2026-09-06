# Archived Campaign Level Format

This is the schema and authoring reference for removed classic content and
historical replay/backend fixtures. These level definitions do not describe the
current endless game's generated pockets. Current runtime documentation is in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

Pullthread levels are immutable TypeScript data in
`src/game/levels/campaignLevels.ts`. The schema lives in
`src/game/levels/schema.ts`; the catalog is validated as soon as it is loaded.
Screens and renderers receive a `LevelDefinition` and must not branch on a
specific level id to implement gameplay rules.

## Coordinate and identity rules

- Geometry uses canonical fabric coordinates. The current campaign bounds are
  `(0, 0)` through `(1, 1.5)`, independent of screen pixels and safe areas.
- Quilt, level, stitch, region, hazard, bumper, and collectible ids use stable
  lowercase kebab-case values.
- Quilt and level `order` values are one-based, unique, and contiguous across
  their catalogs. Each catalog array must already be in canonical ascending
  `order`; permutations are invalid even when they contain the same values.
- Increment a level's `version` whenever authored geometry or simulation rules
  change in a way that would change an existing replay. Replays with an unknown
  level id or stale version are rejected.

## Quilt definition

```ts
interface QuiltDefinition {
  id: string;
  version: number;
  order: number;
  name: string;
  description: string;
}
```

`CAMPAIGN_QUILTS` currently contains Bedroom, Attic, and Festival in that
order. A level's `quiltId` must point to one of these definitions.

## Level definition

| Field | Purpose |
| --- | --- |
| `id`, `version`, `order`, `quiltId` | Stable catalog identity, replay version, campaign position, and owning quilt. |
| `name`, `mechanic` | Player-facing title and short mechanic description. |
| `fabricBounds` | Canonical rectangular play area. |
| `gridColumns`, `gridRows` | Height-field resolution; both must be at least 2. |
| `baseSlope` | Deterministic `x`, `y`, and `originHeight` values used to build the immutable base field. |
| `traveler` | Start point and circular radius, fully inside the fabric. |
| `goal` | Center, radius, and maximum accepted entry speed. |
| `fabricRegions` | Ordered rectangular felt, silk, or elastic regions. The first matching authored region supplies the material. |
| `hazards` | Circular `hole` or `thorn` failure regions. |
| `bumpers` | Circular collision objects with optional authored restitution. |
| `collectible` | Optional circular embroidered patch. |
| `allowedStitchTypes` | Non-empty unique list containing `pinch`, `pocket`, or both. |
| `stitchInfluenceRadii` | Versioned pinch and pocket deformation radii used by physics and rendering. |
| `maxStitches` | Positive maximum number of committed stitches. |
| `threadBudget` | Positive hard limit enforced while planning and while parsing replay data. |
| `targetThreadUsage` | Inclusive scoring target; it cannot exceed the hard budget. |
| `completionRequirements` | Optional deterministic completion gates: minimum stitches/thread, required stitch or fabric types, and required bumper ids. |
| `physicsConfig` | Fixed timestep, gravity, friction, speed, stuck, timeout, substep, and frame-delta limits. |
| `referenceSolution` | One or more canonical stitches used by catalog and deterministic tests. |

Every rectangular or circular object must fit inside `fabricBounds`. Object ids
must be unique within a level. Bumper restitution must be finite and between 0
and 1 inclusive so authored data matches the physics bound. Elastic fabric may
raise a lower authored value to its documented material minimum at runtime.

## Stitch and budget rules

A reference stitch contains a stable id, `pinch` or `pocket` type, canonical
start/end points, tension, deformation radius, and integer `threadCost`.

- Endpoints must be inside the fabric.
- Tension must be exactly `1`, matching player-authored input.
- Radius must match the input factory: `0.19` for pinch and `0.24` for pocket.
- The level's versioned `stitchInfluenceRadii` may render and simulate a
  narrower affected area without changing the replay's canonical input data.
- Endpoints must already use the same canonical quantization as player input.
- The drag must meet the shared minimum stitch length after quantization.
- The type must be listed in the level's `allowedStitchTypes`.
- `threadCost` must exactly equal the canonical endpoint cost returned by
  `calculateThreadCost`; authored overrides are rejected.
- The reference solution cannot exceed `maxStitches`, `threadBudget`, or
  `targetThreadUsage`.

Player input and replay parsing apply the same stitch-count, type, geometry,
and thread-budget boundaries. Replay JSON is untrusted even when it came from
local storage.

## Completion requirement rules

`completionRequirements` is optional. When present, entering the goal succeeds
only after every authored condition is satisfied:

- `minimumStitches` and `minimumThreadUsed` cannot exceed the hard level limits
  or the canonical reference solution.
- `requiredStitchTypes` must be allowed by the level and present in its
  reference solution.
- `requireEveryStitchVisited` makes every committed stitch part of the route:
  the traveler must pass within that stitch's effective influence radius.
- `requiredFabricTypes` must name authored fabric regions that the reference
  route visits.
- `requiredBumperIds` must resolve to authored bumpers that the reference route
  hits.

Requirement arrays are unique, and all requirements are part of deterministic
simulation and replay validation. The play screen derives concise player copy
from the typed fields; stable internal bumper ids are never shown as labels.

## Validation and runtime loading

Use the exported validation functions rather than duplicating checks:

```ts
validateQuiltDefinition(quilt);
validateLevelDefinition(level);
validateCampaignCatalog(quilts, levels);
```

`validateCampaignCatalog` also rejects duplicate ids/orders, missing quilt
references, non-contiguous ordering, and catalog arrays that are not already in
canonical ascending order. `campaignLevels.ts` calls it at module load so
invalid authored content fails early in development and tests.

Runtime consumers use `levelLoader.ts`:

- `getCampaignLevel(levelId)` and `getCampaignQuilt(quiltId)` perform strict
  catalog lookup.
- `getLevelVersion(levelId, version)` resolves current campaign content or an
  explicitly retained historical definition.
- `getCampaignLevelsForQuilt(quiltId)` and `getNextCampaignLevel(levelId)`
  expose campaign order.
- `createLevelWorld(level, stitches, preview?)` builds the shared deformed
  surface plus materials, hazards, bumpers, goal, and collectible.
- `createLevelSimulation(level)` and `createLevelPhysicsConfig(level)` create
  the canonical fixed-step run inputs.

## Authoring checklist

1. Choose the owning quilt and next contiguous campaign order.
2. Add an immutable level with stable ids and all geometry inside the fabric.
3. Set stitch/thread limits, a scoring target, and any completion requirements
   that the reference solution satisfies.
4. Add only the regions, hazards, bumpers, or collectible needed to teach the
   level's named mechanic.
5. Run the catalog tests, repeated reference-solution simulation tests, and a
   shortcut regression proving the named requirements reject cheaper bypasses.
6. Create and replay the solution through `createLevelReplay` and
   `simulateLevelReplay`; do not add a level-specific replay path.
7. If a shipped level's deterministic outcome changes, increment its version
   and add any required save/replay migration policy before release.
8. Do not rewrite a level version referenced by a shipped Daily Scrap pool.
   Preserve the historical definition in the versioned loader or leave that
   level unchanged.
