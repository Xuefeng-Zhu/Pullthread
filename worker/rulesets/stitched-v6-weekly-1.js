// Frozen competition engine. See README.md; never modify a released ruleset.

// src/game/launch/toolEffects.ts
var BOUNCE_PATCH_LENGTH = 72;
var BOUNCE_PATCH_THICKNESS = 12;
var BOUNCE_PATCH_RESTITUTION = 0.98;
var STITCH_POCKET_WIDTH = 80;
var VELCRO_CAPTURE_HEIGHT = 28;
var SAIL_GRAVITY_SCALE = 0.35;
var SAIL_TERMINAL_SPEED = 180;
function effectiveToolTick(id, tick, state) {
  "worklet";
  const pin = state?.toolEffects?.pin;
  return (pin?.targetId === id ? pin.startedTick : tick) - (state?.toolPhaseOffsets?.[id] ?? 0);
}
function effectivePockets(room, state) {
  "worklet";
  return state.stitchedPocket ? [...room.pockets, state.stitchedPocket.pocket] : room.pockets;
}
function clearFlightToolEffects(state) {
  const pin = state.toolEffects?.pin;
  if (pin) {
    state.toolPhaseOffsets ??= {};
    state.toolPhaseOffsets[pin.targetId] = (state.toolPhaseOffsets[pin.targetId] ?? 0) + state.tick - pin.startedTick;
  }
  state.toolEffects = void 0;
}
function pruneToolPhaseOffsets(room, state) {
  if (!state.toolPhaseOffsets) return;
  const ids = new Set([...room.pockets, ...room.hazards, ...room.barriers ?? []].map((item) => item.id));
  state.toolPhaseOffsets = Object.fromEntries(Object.entries(state.toolPhaseOffsets).filter(([id]) => ids.has(id)));
}
function integrateFlightVertical(velocity, seconds, gravity, sail = false) {
  "worklet";
  if (!sail || gravity <= 0) return { distance: velocity * seconds + gravity * seconds * seconds / 2, velocity: velocity + gravity * seconds };
  let distance = 0, remaining = seconds, vy = velocity;
  if (vy < 0) {
    const ascent = Math.min(remaining, -vy / gravity);
    distance += vy * ascent + gravity * ascent * ascent / 2;
    vy += gravity * ascent;
    remaining -= ascent;
  }
  if (remaining > 0) {
    vy = Math.min(SAIL_TERMINAL_SPEED, Math.max(0, vy));
    const acceleration = gravity * SAIL_GRAVITY_SCALE;
    const accelerating = Math.min(remaining, (SAIL_TERMINAL_SPEED - vy) / acceleration);
    distance += vy * accelerating + acceleration * accelerating * accelerating / 2;
    vy += acceleration * accelerating;
    distance += vy * (remaining - accelerating);
  }
  return { distance, velocity: vy };
}

// src/game/launch/interactivePhysics.ts
var SHUTTER_PERIOD_TICKS = 480;
function shutterPhase(barrier2, tick, state) {
  "worklet";
  tick = effectiveToolTick(barrier2.id, tick, state);
  const phase = ((tick + (barrier2.phaseTicks ?? 0)) % SHUTTER_PERIOD_TICKS + SHUTTER_PERIOD_TICKS) % SHUTTER_PERIOD_TICKS;
  return phase < 240 ? "open" : phase < 330 ? "warning" : "closed";
}
function barrierIsActive(barrier2, room, state, tick) {
  "worklet";
  if (barrier2.kind === "tearable") return !state.brokenBarrierIds?.includes(barrier2.id);
  if (barrier2.kind === "door") return !room.switches?.some((sensor2) => sensor2.doorIds.includes(barrier2.id) && state.activatedSwitchIds?.includes(sensor2.id));
  return barrier2.kind !== "shutter" || shutterPhase(barrier2, tick, state) === "closed";
}
function sweepCircleCapsule(start, end, capsule, radius, captureInitialOverlap = false) {
  "worklet";
  const angle = capsule.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const local = (point2) => ({
    x: (point2.x - capsule.position.x) * c + (point2.y - capsule.position.y) * s,
    y: -(point2.x - capsule.position.x) * s + (point2.y - capsule.position.y) * c
  });
  const a = local(start), b = local(end), dx = b.x - a.x, dy = b.y - a.y;
  const half = (capsule.length - capsule.thickness) / 2, r = capsule.thickness / 2 + radius;
  let best;
  const consider = (time, normal, position2) => {
    if (time < 0 || time > 1 || best && time >= best.time || dx * normal.x + dy * normal.y >= 0) return;
    best = { time, normal, position: position2 ?? { x: a.x + dx * time, y: a.y + dy * time } };
  };
  const nearX = Math.max(-half, Math.min(half, a.x)), ox = a.x - nearX;
  const initialDistance = Math.hypot(ox, a.y);
  if (initialDistance <= r) {
    const normal = initialDistance > 1e-8 ? { x: ox / initialDistance, y: a.y / initialDistance } : { x: 0, y: dy > 0 ? -1 : 1 };
    const position2 = { x: nearX + normal.x * r, y: normal.y * r };
    if (captureInitialOverlap) best = { time: 0, normal, position: position2 };
    else consider(0, normal, position2);
  }
  if (dy !== 0) for (const side of [-1, 1]) {
    const time = (side * r - a.y) / dy;
    const x = a.x + dx * time;
    if (x >= -half && x <= half) consider(time, { x: 0, y: side });
  }
  const magnitude = dx * dx + dy * dy;
  if (magnitude > 1e-12) for (const side of [-1, 1]) {
    const centerX = side * half, offsetX = a.x - centerX;
    const qb = 2 * (offsetX * dx + a.y * dy), qc = offsetX * offsetX + a.y * a.y - r * r;
    const discriminant = qb * qb - 4 * magnitude * qc;
    if (discriminant < 0) continue;
    const time = (-qb - Math.sqrt(discriminant)) / (2 * magnitude);
    const x = a.x + dx * time - centerX, y = a.y + dy * time;
    if (side * x >= -1e-8) consider(time, { x: x / r, y: y / r });
  }
  if (!best) return void 0;
  const hit = best;
  return {
    time: hit.time,
    normal: { x: hit.normal.x * c - hit.normal.y * s, y: hit.normal.x * s + hit.normal.y * c },
    position: {
      x: capsule.position.x + hit.position.x * c - hit.position.y * s,
      y: capsule.position.y + hit.position.x * s + hit.position.y * c
    }
  };
}
function sweepCircleRectangle(start, end, rectangle, radius) {
  const left = rectangle.x, right = left + rectangle.width;
  const top = rectangle.y, bottom = top + rectangle.height;
  const dx = end.x - start.x, dy = end.y - start.y;
  const nearX = Math.max(left, Math.min(right, start.x));
  const nearY = Math.max(top, Math.min(bottom, start.y));
  const offsetX = start.x - nearX, offsetY = start.y - nearY;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance <= radius) {
    if (distance > 1e-8) {
      const normal = { x: offsetX / distance, y: offsetY / distance };
      return { time: 0, normal, position: { x: nearX + normal.x * radius, y: nearY + normal.y * radius } };
    }
    const faces = [
      { distance: start.x - left, normal: { x: -1, y: 0 }, position: { x: left - radius, y: start.y } },
      { distance: right - start.x, normal: { x: 1, y: 0 }, position: { x: right + radius, y: start.y } },
      { distance: start.y - top, normal: { x: 0, y: -1 }, position: { x: start.x, y: top - radius } },
      { distance: bottom - start.y, normal: { x: 0, y: 1 }, position: { x: start.x, y: bottom + radius } }
    ];
    const face = faces.reduce((best2, next) => next.distance < best2.distance ? next : best2);
    return { time: 0, normal: face.normal, position: face.position };
  }
  let best;
  const consider = (time, normal) => {
    if (time < 0 || time > 1 || best && time >= best.time || dx * normal.x + dy * normal.y >= 0) return;
    best = { time, normal, position: { x: start.x + dx * time, y: start.y + dy * time } };
  };
  if (dx !== 0) for (const [x, sign] of [[left - radius, -1], [right + radius, 1]]) {
    const time = (x - start.x) / dx;
    const y = start.y + dy * time;
    if (y >= top && y <= bottom) consider(time, { x: sign, y: 0 });
  }
  if (dy !== 0) for (const [y, sign] of [[top - radius, -1], [bottom + radius, 1]]) {
    const time = (y - start.y) / dy;
    const x = start.x + dx * time;
    if (x >= left && x <= right) consider(time, { x: 0, y: sign });
  }
  const a = dx * dx + dy * dy;
  if (a > 1e-12) for (const [x, sx] of [[left, -1], [right, 1]]) for (const [y, sy] of [[top, -1], [bottom, 1]]) {
    const ox = start.x - x, oy = start.y - y;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const time = (-b - Math.sqrt(discriminant)) / (2 * a);
    const px = start.x + dx * time - x, py = start.y + dy * time - y;
    if (px * sx >= -1e-8 && py * sy >= -1e-8) consider(time, { x: px / radius, y: py / radius });
  }
  return best;
}

// src/game/launch/simulation.ts
var LAUNCH_HZ = 120;
var LAUNCH_STEP_SECONDS = 1 / LAUNCH_HZ;
var BUTTON_RADIUS = 10;
var MAX_PULL = 100;
var MIN_PULL = 8;
var LAUNCH_POWER = 7.5;
var MAX_FLIGHT_TICKS = LAUNCH_HZ * 8;
var EPSILON = 1e-8;
var MAX_CONTACTS_PER_STEP = 8;
var BARRIER_ESCAPE_SPEED = 360;
var BARRIER_ESCAPE_NORMAL_SPEED = 180;
var BARRIER_RESTING_NORMAL_SPEED = 90;
function pocketPosition(pocket2, tick, state) {
  "worklet";
  tick = effectiveToolTick(pocket2.id, tick, state);
  if (pocket2.orbit) {
    const orbit = pocket2.orbit;
    const angle = (tick * (orbit.direction ?? 1) + orbit.phaseTicks) / orbit.periodTicks * Math.PI * 2;
    return { x: pocket2.center.x + Math.cos(angle) * orbit.radius, y: pocket2.center.y + Math.sin(angle) * orbit.radius };
  }
  const { motion } = pocket2;
  return {
    x: pocket2.center.x + (motion && motion.periodTicks > 0 ? Math.sin((tick + motion.phaseTicks) / motion.periodTicks * Math.PI * 2) * motion.amplitude : 0),
    y: pocket2.center.y
  };
}
function pocketVelocity(pocket2, tick, state) {
  "worklet";
  if (state?.toolEffects?.pin?.targetId === pocket2.id) return { x: 0, y: 0 };
  tick = effectiveToolTick(pocket2.id, tick, state);
  if (!pocket2.orbit) return { x: 0, y: 0 };
  const orbit = pocket2.orbit;
  const angle = (tick * (orbit.direction ?? 1) + orbit.phaseTicks) / orbit.periodTicks * Math.PI * 2;
  const speed = (orbit.direction ?? 1) * orbit.radius * Math.PI * 2 * LAUNCH_HZ / orbit.periodTicks;
  return { x: -Math.sin(angle) * speed, y: Math.cos(angle) * speed };
}
function launchVelocity(pocket2, tick, pull, state) {
  "worklet";
  const carried = pocketVelocity(pocket2, tick, state);
  const velocity = { x: -pull.x * LAUNCH_POWER + carried.x, y: -pull.y * LAUNCH_POWER + carried.y };
  const magnitude = Math.hypot(velocity.x, velocity.y);
  if (pocket2.orbit && magnitude > 850) return { x: velocity.x * 850 / magnitude, y: velocity.y * 850 / magnitude };
  return velocity;
}
function activateLandingSwitches(room, state, pocketId2) {
  const events = [];
  for (const sensor2 of room.switches ?? []) {
    if (state.activatedSwitchIds?.includes(sensor2.id)) continue;
    if (sensor2.pocketId !== pocketId2 && Math.hypot(state.position.x - sensor2.center.x, state.position.y - sensor2.center.y) > sensor2.radius + BUTTON_RADIUS) continue;
    state.activatedSwitchIds = [...state.activatedSwitchIds ?? [], sensor2.id];
    events.push({ type: "switch", tick: state.tick, id: sensor2.id });
  }
  return events;
}
function windAccelerationAt(zones, position2) {
  "worklet";
  let acceleration = 0;
  for (const zone of zones ?? []) {
    if (position2.x >= zone.x && position2.x < zone.x + zone.width && position2.y >= zone.y && position2.y < zone.y + zone.height) acceleration += zone.accelerationX;
  }
  return acceleration;
}
function hazardPosition(hazard, tick, state) {
  "worklet";
  tick = effectiveToolTick(hazard.id, tick, state);
  const { motion } = hazard;
  const offset = motion && motion.periodTicks > 0 ? Math.sin((tick + motion.phaseTicks) / motion.periodTicks * Math.PI * 2) * motion.amplitude : 0;
  return {
    x: hazard.center.x + (motion?.axis === "y" ? 0 : offset),
    y: hazard.center.y + (motion?.axis === "y" ? offset : 0)
  };
}
function startPocketLifetime(state, pocket2) {
  if (pocket2.frayTicks === void 0 || pocket2.frayTicks <= 0) return;
  state.pocketExpiryTicks ??= {};
  if (state.pocketExpiryTicks[pocket2.id] === void 0) {
    state.pocketExpiryTicks[pocket2.id] = state.tick + pocket2.frayTicks;
  }
}
function isPocketExpired(state, pocket2, tick = state.tick) {
  "worklet";
  const expires = state.pocketExpiryTicks?.[pocket2.id];
  return expires !== void 0 && tick >= expires;
}
function clampPull(pull) {
  "worklet";
  if (!Number.isFinite(pull.x) || !Number.isFinite(pull.y)) return { x: 0, y: 0 };
  const x = Math.round(pull.x * 100) / 100;
  const y = Math.round(pull.y * 100) / 100;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length)) return { x: 0, y: 0 };
  const scale = length > MAX_PULL ? MAX_PULL / length : 1;
  return { x: x * scale, y: y * scale };
}
function findPocket(room, id, state) {
  const pocket2 = (state ? effectivePockets(room, state) : room.pockets).find((candidate) => candidate.id === id);
  if (!pocket2) throw new Error(`Launch room ${room.id} has no pocket ${id}`);
  return pocket2;
}
function createLaunchState(room) {
  const pocket2 = findPocket(room, room.startPocketId);
  const position2 = pocketPosition(pocket2, 0);
  const state = {
    tick: 0,
    phase: "held",
    position: position2,
    previousPosition: { ...position2 },
    velocity: { x: 0, y: 0 },
    pocketId: room.startPocketId,
    checkpoint: { pocketId: room.startPocketId, tick: 0, patchCollected: false },
    patchCollected: false,
    pickupIds: [],
    ...room.barriers !== void 0 || room.switches !== void 0 ? { brokenBarrierIds: [], activatedSwitchIds: [] } : {},
    flightTicks: 0,
    launches: 0,
    sourcePocketImmune: true
  };
  startPocketLifetime(state, pocket2);
  return state;
}
function launch(room, state, input) {
  if (state.phase !== "held" || !Number.isInteger(input.tick) || input.tick !== state.tick || input.pocketId !== state.pocketId) return false;
  const pull = clampPull(input.pull);
  if (Math.hypot(pull.x, pull.y) < MIN_PULL) return false;
  const pocket2 = findPocket(room, state.pocketId, state);
  if (isPocketExpired(state, pocket2)) return false;
  const anchor = pocketPosition(pocket2, state.tick, state);
  state.position = { x: anchor.x + pull.x, y: anchor.y + pull.y };
  state.previousPosition = { ...state.position };
  state.velocity = launchVelocity(pocket2, state.tick, pull, state);
  if (state.stitchedPocket?.pocket.id === state.pocketId) state.stitchedPocket.spent = true;
  state.phase = "flying";
  state.flightTicks = 0;
  state.launches += 1;
  state.sourcePocketImmune = true;
  state.failure = void 0;
  if (state.frayedFall !== void 0) state.frayedFall = false;
  state.event = { type: "launch", tick: state.tick, id: state.pocketId };
  return true;
}
function circleContact(start, end, center, radius) {
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  if (c <= 0) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const a = dx * dx + dy * dy;
  if (a <= EPSILON) return void 0;
  const b = 2 * (offsetX * dx + offsetY * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return void 0;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= 0 && time <= 1 ? time : void 0;
}
function contactPriority(contact) {
  return { hazard: 0, bounds: 1, pocket: 2, bumper: 3, toolBounce: 3, wall: 3, patch: 4, pickup: 5, barrier: 3, switch: 1.5 }[contact.kind];
}
function findContact(room, state, start, end, tickStart, tickEnd) {
  let earliest;
  function consider(candidate) {
    if (!earliest || candidate.time < earliest.time - EPSILON || Math.abs(candidate.time - earliest.time) <= EPSILON && (contactPriority(candidate) < contactPriority(earliest) || contactPriority(candidate) === contactPriority(earliest) && candidate.key < earliest.key)) earliest = candidate;
  }
  room.hazards.forEach((hazard, index) => {
    if (state.toolEffects?.needle?.piercedId === hazard.id) return;
    const from = hazardPosition(hazard, tickStart, state);
    const to = hazardPosition(hazard, tickEnd, state);
    const time = hazard.motion ? circleContact(
      { x: start.x - from.x, y: start.y - from.y },
      { x: end.x - to.x, y: end.y - to.y },
      { x: 0, y: 0 },
      hazard.radius + BUTTON_RADIUS
    ) : circleContact(start, end, hazard.center, hazard.radius + BUTTON_RADIUS);
    if (time !== void 0) consider({ kind: "hazard", index, time, key: hazard.id, needleEligible: hazard.visual !== "scissors" });
  });
  const patch = state.toolEffects?.bounce;
  if (patch && !patch.spent) {
    const hit = sweepCircleCapsule(start, end, { ...patch, length: BOUNCE_PATCH_LENGTH, thickness: BOUNCE_PATCH_THICKNESS }, BUTTON_RADIUS);
    if (hit) consider({ kind: "toolBounce", key: "tool-bounce", time: hit.time, hit });
  }
  room.bumpers.forEach((bumper, index) => {
    const time = circleContact(start, end, bumper.center, bumper.radius + BUTTON_RADIUS);
    if (time === void 0) return;
    const x = start.x + (end.x - start.x) * time - bumper.center.x;
    const y = start.y + (end.y - start.y) * time - bumper.center.y;
    if (x * (end.x - start.x) + y * (end.y - start.y) >= 0) return;
    consider({ kind: "bumper", index, time, key: bumper.id });
  });
  room.barriers?.forEach((barrier2, index) => {
    if (state.toolEffects?.needle?.piercedId === barrier2.id) return;
    if (!barrierIsActive(barrier2, room, state, tickEnd)) return;
    const hit = sweepCircleRectangle(start, end, barrier2, BUTTON_RADIUS);
    if (!hit) return;
    const lethal = barrier2.kind === "thorns" || barrier2.kind === "shutter";
    const outward = (end.x - start.x) * hit.normal.x + (end.y - start.y) * hit.normal.y >= 0;
    const penetrated = Math.hypot(start.x - hit.position.x, start.y - hit.position.y) > 1e-7;
    if (!lethal && hit.time === 0 && outward && !penetrated) return;
    if (lethal) consider({ kind: "hazard", index: -1, time: hit.time, key: barrier2.id, needleEligible: barrier2.kind === "thorns" });
    else consider({ kind: "barrier", index, time: hit.time, key: barrier2.id, hit });
  });
  room.switches?.forEach((sensor2, index) => {
    if (state.activatedSwitchIds?.includes(sensor2.id)) return;
    const time = circleContact(start, end, sensor2.center, sensor2.radius + BUTTON_RADIUS);
    if (time !== void 0) consider({ kind: "switch", index, time, key: sensor2.id });
  });
  effectivePockets(room, state).forEach((pocket2, index) => {
    if (state.stitchedPocket?.spent && pocket2.id === state.stitchedPocket.pocket.id) return;
    if (isPocketExpired(state, pocket2, tickEnd)) return;
    if (pocket2.id === state.pocketId && state.sourcePocketImmune) return;
    if (state.toolEffects?.velcro?.targetId === pocket2.id) {
      const before = pocketPosition(pocket2, tickStart, state), after = pocketPosition(pocket2, tickEnd, state);
      const hit = sweepCircleCapsule(
        { x: start.x - before.x, y: start.y - before.y },
        { x: end.x - after.x, y: end.y - after.y },
        { position: { x: 0, y: 0 }, angle: 0, length: pocket2.width, thickness: VELCRO_CAPTURE_HEIGHT },
        0,
        true
      );
      if (hit) consider({ kind: "pocket", index, time: hit.time, key: pocket2.id });
    }
    if (pocket2.orbit) {
      const mouthStart = pocketPosition(pocket2, tickStart, state);
      const mouthEnd = pocketPosition(pocket2, tickEnd, state);
      const before = start.y - mouthStart.y, after = end.y - mouthEnd.y;
      if (before > 0 || after < 0 || after <= before) return;
      const time = -before / (after - before);
      const mouthX = mouthStart.x + (mouthEnd.x - mouthStart.x) * time;
      if (Math.abs(start.x + (end.x - start.x) * time - mouthX) <= pocket2.width / 2 - BUTTON_RADIUS * 0.35) {
        consider({ kind: "pocket", index, time, key: pocket2.id });
      }
    } else if (end.y > start.y) {
      const time = (pocket2.center.y - start.y) / (end.y - start.y);
      if (time < 0 || time > 1) return;
      const mouth = pocketPosition(pocket2, tickStart + (tickEnd - tickStart) * time, state);
      const x = start.x + (end.x - start.x) * time;
      if (Math.abs(x - mouth.x) <= pocket2.width / 2 - BUTTON_RADIUS * 0.35) consider({ kind: "pocket", index, time, key: pocket2.id });
    }
  });
  if (room.patch && !state.patchCollected) {
    const time = circleContact(start, end, room.patch.center, room.patch.radius + BUTTON_RADIUS);
    if (time !== void 0) consider({ kind: "patch", time, key: "" });
  }
  room.pickups?.forEach((pickup, index) => {
    if (state.pickupIds.includes(pickup.id)) return;
    const time = circleContact(start, end, pickup.center, pickup.radius + BUTTON_RADIUS);
    if (time !== void 0) consider({ kind: "pickup", index, time, key: pickup.id });
  });
  const bouncingWalls = room.sideWallRestitution !== void 0;
  if (bouncingWalls) {
    const left = BUTTON_RADIUS;
    const right = room.bounds.width - BUTTON_RADIUS;
    if (start.x < left) consider({ kind: "wall", side: "left", time: 0, key: "wall-left" });
    else if (end.x <= left && end.x < start.x) {
      consider({ kind: "wall", side: "left", time: (left - start.x) / (end.x - start.x), key: "wall-left" });
    }
    if (start.x > right) consider({ kind: "wall", side: "right", time: 0, key: "wall-right" });
    else if (end.x >= right && end.x > start.x) {
      consider({ kind: "wall", side: "right", time: (right - start.x) / (end.x - start.x), key: "wall-right" });
    }
  }
  const bounds = [
    ...bouncingWalls ? [] : [{ from: start.x, to: end.x, min: -BUTTON_RADIUS, max: room.bounds.width + BUTTON_RADIUS }],
    {
      from: start.y,
      to: end.y,
      min: room.bounds.top ?? -BUTTON_RADIUS,
      max: room.bounds.bottom ?? room.bounds.height + BUTTON_RADIUS
    }
  ];
  bounds.forEach(({ from, to, min, max }) => {
    if (from < min || from > max) consider({ kind: "bounds", time: 0, key: "" });
    else if (to < min) consider({ kind: "bounds", time: (min - from) / (to - from), key: "" });
    else if (to > max) consider({ kind: "bounds", time: (max - from) / (to - from), key: "" });
  });
  return earliest;
}
function barrierEscapeDirection(room, barrier2, x) {
  const leftEdgeReachable = barrier2.x - BUTTON_RADIUS > BUTTON_RADIUS + EPSILON;
  const rightEdgeReachable = barrier2.x + barrier2.width + BUTTON_RADIUS < room.bounds.width - BUTTON_RADIUS - EPSILON;
  if (!leftEdgeReachable && rightEdgeReachable) return 1;
  if (leftEdgeReachable && !rightEdgeReachable) return -1;
  return x < barrier2.x + barrier2.width / 2 ? -1 : 1;
}
function fail(state, reason) {
  state.phase = "failed";
  state.failure = reason;
  state.velocity = { x: 0, y: 0 };
  return { type: "fail", tick: state.tick, reason };
}
function stepLaunch(room, state) {
  if (state.phase === "failed" || state.phase === "complete") return [];
  const previousTick = state.tick;
  state.tick += 1;
  state.previousPosition = { ...state.position };
  if (state.phase === "held") {
    const pocket2 = findPocket(room, state.pocketId, state);
    state.position = pocketPosition(pocket2, state.tick, state);
    if (isPocketExpired(state, pocket2)) {
      state.phase = "flying";
      state.velocity = { x: 0, y: 0 };
      state.flightTicks = 0;
      state.sourcePocketImmune = true;
      state.frayedFall = true;
      state.event = { type: "fray", tick: state.tick, id: pocket2.id };
      return [state.event];
    }
    return [];
  }
  const events = [];
  state.flightTicks += 1;
  state.velocity.x += windAccelerationAt(room.windZones, state.position) * LAUNCH_STEP_SECONDS;
  let remaining = LAUNCH_STEP_SECONDS;
  let elapsed = 0;
  for (let count = 0; count < MAX_CONTACTS_PER_STEP && remaining > EPSILON; count += 1) {
    const source = pocketPosition(findPocket(room, state.pocketId, state), previousTick, state);
    const sourceWidth = findPocket(room, state.pocketId, state).width;
    if (state.sourcePocketImmune && (state.position.y < source.y - BUTTON_RADIUS || Math.abs(state.position.x - source.x) > sourceWidth / 2 + BUTTON_RADIUS)) state.sourcePocketImmune = false;
    const start = state.position;
    const vertical = integrateFlightVertical(state.velocity.y, remaining, room.gravity, state.toolEffects?.sail);
    const end = {
      x: start.x + state.velocity.x * remaining,
      y: state.toolEffects?.sail ? start.y + vertical.distance : start.y + state.velocity.y * remaining + room.gravity * remaining * remaining / 2
    };
    let contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
    while (contact?.kind === "pickup" || contact?.kind === "switch" || contact?.kind === "hazard" && contact.needleEligible && state.toolEffects?.needle && !state.toolEffects.needle.piercedId) {
      if (contact.kind === "hazard") {
        state.toolEffects.needle.piercedId = contact.key;
        events.push({ type: "tool", tick: state.tick, id: contact.key, kind: "needle" });
        contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
        continue;
      }
      if (contact.kind === "switch") {
        const sensor2 = room.switches[contact.index];
        state.activatedSwitchIds = [...state.activatedSwitchIds ?? [], sensor2.id];
        events.push({ type: "switch", tick: state.tick, id: sensor2.id });
        contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
        continue;
      }
      const pickup = room.pickups[contact.index];
      state.pickupIds.push(pickup.id);
      events.push({ type: "pickup", tick: state.tick, id: pickup.id, kind: pickup.kind });
      contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
    }
    const fraction = contact?.time ?? 1;
    const duration = remaining * fraction;
    const elapsedVertical = integrateFlightVertical(state.velocity.y, duration, room.gravity, state.toolEffects?.sail);
    state.position = {
      x: start.x + (end.x - start.x) * fraction,
      // A horizontal wall changes no vertical physics. Integrate the exact
      // elapsed ballistic time instead of splitting the full-step chord.
      y: contact?.kind === "wall" ? state.toolEffects?.sail ? start.y + elapsedVertical.distance : start.y + state.velocity.y * duration + room.gravity * duration * duration / 2 : start.y + (end.y - start.y) * fraction
    };
    state.velocity.y = elapsedVertical.velocity;
    remaining -= duration;
    elapsed += duration;
    if (!contact) break;
    if (contact.kind === "hazard" || contact.kind === "bounds") {
      events.push(fail(state, contact.kind === "hazard" ? "hazard" : "out_of_bounds"));
      break;
    }
    if (contact.kind === "patch") {
      state.patchCollected = true;
      events.push({ type: "patch", tick: state.tick });
      continue;
    }
    if (contact.kind === "wall") {
      const restitution2 = Math.max(0, Math.min(1, room.sideWallRestitution));
      state.position.x = contact.side === "left" ? BUTTON_RADIUS : room.bounds.width - BUTTON_RADIUS;
      if (contact.side === "left" && state.velocity.x < 0 || contact.side === "right" && state.velocity.x > 0) {
        state.velocity.x = -state.velocity.x * restitution2;
      }
      events.push({ type: "bounce", tick: state.tick, id: contact.key });
      continue;
    }
    if (contact.kind === "pocket") {
      const pocket2 = effectivePockets(room, state)[contact.index];
      state.pocketId = pocket2.id;
      startPocketLifetime(state, pocket2);
      if (state.frayedFall !== void 0) state.frayedFall = false;
      state.position = pocketPosition(pocket2, state.tick, state);
      events.push(...activateLandingSwitches(room, state, pocket2.id));
      state.velocity = { x: 0, y: 0 };
      state.flightTicks = 0;
      state.sourcePocketImmune = true;
      if (pocket2.kind === "goal") {
        state.phase = "complete";
        events.push({ type: "complete", tick: state.tick, id: pocket2.id });
      } else {
        state.phase = "held";
        state.checkpoint = { pocketId: pocket2.id, tick: state.tick, patchCollected: state.patchCollected };
        events.push({ type: "catch", tick: state.tick, id: pocket2.id });
      }
      break;
    }
    if (contact.kind === "toolBounce") {
      const normal = contact.hit.normal;
      const incoming = state.velocity.x * normal.x + state.velocity.y * normal.y;
      if (incoming < 0) {
        state.velocity.x -= (1 + BOUNCE_PATCH_RESTITUTION) * incoming * normal.x;
        state.velocity.y -= (1 + BOUNCE_PATCH_RESTITUTION) * incoming * normal.y;
      }
      state.toolEffects.bounce.spent = true;
      state.position = { x: contact.hit.position.x + normal.x * 1e-3, y: contact.hit.position.y + normal.y * 1e-3 };
      events.push({ type: "bounce", tick: state.tick, id: contact.key });
      continue;
    }
    if (contact.kind === "barrier") {
      const barrier2 = room.barriers[contact.index];
      const normal = contact.hit.normal;
      const incoming = state.velocity.x * normal.x + state.velocity.y * normal.y;
      if (barrier2.kind === "tearable" && -incoming >= 400) {
        state.brokenBarrierIds = [...state.brokenBarrierIds ?? [], barrier2.id];
        state.velocity.x -= incoming * 0.25 * normal.x;
        state.velocity.y -= incoming * 0.25 * normal.y;
        events.push({ type: "break", tick: state.tick, id: barrier2.id });
      } else {
        if (incoming < 0) {
          state.velocity.x -= 1.55 * incoming * normal.x;
          state.velocity.y -= 1.55 * incoming * normal.y;
        }
        const outwardSpeed = state.velocity.x * normal.x + state.velocity.y * normal.y;
        if (Math.abs(normal.x) < EPSILON && normal.y < -1 + EPSILON && outwardSpeed < BARRIER_RESTING_NORMAL_SPEED && Math.abs(state.velocity.x) < BARRIER_ESCAPE_SPEED) {
          state.velocity.x = barrierEscapeDirection(room, barrier2, state.position.x) * BARRIER_ESCAPE_SPEED;
          state.velocity.y += (BARRIER_ESCAPE_NORMAL_SPEED - outwardSpeed) * normal.y;
        }
        state.position = { x: contact.hit.position.x + normal.x * 1e-3, y: contact.hit.position.y + normal.y * 1e-3 };
        events.push({ type: "bounce", tick: state.tick, id: barrier2.id });
      }
      continue;
    }
    const bumper = room.bumpers[contact.index];
    const dx = state.position.x - bumper.center.x;
    const dy = state.position.y - bumper.center.y;
    const distance = Math.hypot(dx, dy);
    const nx = distance > EPSILON ? dx / distance : 0;
    const ny = distance > EPSILON ? dy / distance : -1;
    const inwardSpeed = state.velocity.x * nx + state.velocity.y * ny;
    const restitution = Math.max(0, Math.min(1, bumper.restitution));
    if (inwardSpeed < 0) {
      state.velocity.x -= (1 + restitution) * inwardSpeed * nx;
      state.velocity.y -= (1 + restitution) * inwardSpeed * ny;
      if (bumper.springSpeed !== void 0) {
        const outwardSpeed = state.velocity.x * nx + state.velocity.y * ny;
        const outward = Math.min(850, Math.max(bumper.springSpeed, outwardSpeed));
        const tangent = state.velocity.x * -ny + state.velocity.y * nx;
        const maxTangent = Math.sqrt(Math.max(0, 850 * 850 - outward * outward));
        const limitedTangent = Math.max(-maxTangent, Math.min(maxTangent, tangent));
        state.velocity.x = nx * outward - ny * limitedTangent;
        state.velocity.y = ny * outward + nx * limitedTangent;
      }
    }
    const safeRadius = bumper.radius + BUTTON_RADIUS + 1e-3;
    state.position = { x: bumper.center.x + nx * safeRadius, y: bumper.center.y + ny * safeRadius };
    events.push({ type: "bounce", tick: state.tick, id: bumper.id });
  }
  const timeout = room.flightTimeoutTicks === void 0 ? MAX_FLIGHT_TICKS : room.flightTimeoutTicks;
  if (state.phase === "flying" && timeout !== null && state.flightTicks >= timeout) events.push(fail(state, "timeout"));
  if (events.length) state.event = events[events.length - 1];
  return events;
}

// src/game/launch/launchInput.ts
function clampEndlessPull(pull, anchor, cameraY, bounds) {
  const limited = clampPull(pull);
  return {
    x: Math.max(
      Math.min(0, 12 - anchor.x),
      Math.min(Math.max(0, bounds.width - 12 - anchor.x), limited.x)
    ),
    y: Math.max(
      Math.min(0, cameraY + 12 - anchor.y),
      Math.min(Math.max(0, cameraY + bounds.height - 12 - anchor.y), limited.y)
    )
  };
}

// src/game/launch/bankPatterns.ts
var bands = ["intro", "mixed", "expert"];
var BANK_PATTERNS = bands.flatMap((band) => [
  {
    id: `bank-return-${band}`,
    family: "bank",
    band,
    entryX: { min: 100, max: 100 },
    exitX: { min: 100, max: 100 },
    receiver: { center: { x: 100, y: -232 }, width: 144 },
    bumpers: [{ center: { x: 284, y: -260 }, radius: 48, restitution: 0.95 }],
    hazards: [{ center: { x: 100, y: -104 }, radius: 14 }],
    cue: "Pull away from the cushion. Bounce back above the thorns."
  },
  {
    id: `bank-rise-${band}`,
    family: "bank",
    band,
    entryX: { min: 100, max: 100 },
    exitX: { min: 100, max: 100 },
    receiver: { center: { x: 100, y: -240 }, width: 144 },
    bumpers: [{ center: { x: 280, y: -265 }, radius: 48, restitution: 1 }],
    hazards: [{ center: { x: 100, y: -108 }, radius: 16 }],
    cue: "Aim higher on the cushion to return over the thorns."
  }
]);

// src/game/launch/flightPatterns.ts
var bands2 = ["intro", "mixed", "expert"];
var authored = [];
for (const [difficulty, band] of bands2.entries()) {
  const add = (pattern) => authored.push(pattern);
  const fixedEntry = { min: 100, max: 100 };
  const fixedExit = { min: 260, max: 260 };
  add({
    id: `recovery-${band}-right`,
    family: "recovery",
    band,
    entryX: { min: 100, max: 260 },
    exitX: fixedExit,
    receiver: { center: { x: 260, y: -120 - difficulty * 10 }, width: 144 - difficulty * 12 },
    bumpers: [],
    hazards: [],
    cue: "A roomy pocket. Take a breath and choose your next pull."
  });
  add({
    id: `arc-high-${band}-right`,
    family: "arc",
    band,
    entryX: fixedEntry,
    exitX: fixedExit,
    receiver: { center: { x: 260, y: -130 - difficulty * 8 }, width: 128 - difficulty * 12 },
    bumpers: [],
    hazards: [{ center: { x: 170, y: -65 - difficulty * 4 }, radius: 30 + difficulty }],
    cue: "Stretch deeper to arc above the thorns."
  });
  add({
    id: `arc-low-${band}-right`,
    family: "arc",
    band,
    entryX: { min: 100, max: 260 },
    exitX: fixedExit,
    receiver: { center: { x: 260, y: -110 - difficulty * 5 }, width: 128 - difficulty * 10 },
    bumpers: [],
    hazards: [{ center: { x: 140, y: -222 - difficulty * 4 }, radius: 36 + difficulty * 2 }],
    cue: "Keep this pull light. Slip underneath the high thorns."
  });
  add({
    id: `reverse-flat-${band}-right`,
    family: "reverse",
    band,
    entryX: fixedEntry,
    exitX: fixedExit,
    receiver: { center: { x: 260, y: -110 - difficulty * 12 }, width: 126 - difficulty * 12 },
    bumpers: [],
    hazards: [],
    cue: "Turn your aim across the fabric toward the far pocket."
  });
  add({
    id: `reverse-rise-${band}-right`,
    family: "reverse",
    band,
    entryX: fixedEntry,
    exitX: fixedExit,
    receiver: { center: { x: 260, y: -158 - difficulty * 8 }, width: 128 - difficulty * 12 },
    bumpers: [],
    hazards: [],
    cue: "Reach diagonally upward. This far pocket needs a deeper pull."
  });
  const amplitude = 60 + difficulty * 6;
  const periodTicks = 480 - difficulty * 60;
  for (const phase of [0, periodTicks / 2]) {
    add({
      id: `timing-${band}-${phase === 0 ? "outward" : "return"}-right`,
      family: "timing",
      band,
      entryX: fixedEntry,
      exitX: { min: 180 - amplitude, max: 180 + amplitude },
      receiver: {
        center: { x: 180, y: -(phase === 0 ? 140 : 160) - difficulty * 10 },
        width: 100 - difficulty * 12,
        motion: { amplitude, periodTicks, phaseTicks: phase }
      },
      bumpers: [],
      // Expert receivers combine release timing with a visible limit on power.
      // Their next connector crosses toward the opposite side of this ceiling.
      hazards: difficulty === 2 ? [{
        center: { x: 100, y: phase === 0 ? -300 : -320 },
        radius: 24
      }] : [],
      cue: difficulty === 2 ? "Keep the pull light, then time the moving pocket." : "Watch the pocket, then release as it moves into your arc."
    });
  }
}
var FLIGHT_PATTERNS = authored;

// src/game/launch/challenges.ts
function mirrorChallenge(pattern) {
  const flip = (point2) => ({ x: 360 - point2.x, y: point2.y });
  const range = (value) => ({ min: 360 - value.max, max: 360 - value.min });
  return {
    ...pattern,
    id: `${pattern.id}-mirror`,
    entryX: range(pattern.entryX),
    exitX: range(pattern.exitX),
    receiver: {
      ...pattern.receiver,
      center: flip(pattern.receiver.center),
      ...pattern.receiver.motion ? { motion: {
        ...pattern.receiver.motion,
        phaseTicks: pattern.receiver.motion.phaseTicks + pattern.receiver.motion.periodTicks / 2
      } } : {}
    },
    bumpers: pattern.bumpers.map((bumper) => ({ ...bumper, center: flip(bumper.center) })),
    hazards: pattern.hazards.map((hazard) => ({ ...hazard, center: flip(hazard.center) }))
  };
}
var CHALLENGE_PATTERNS = [...FLIGHT_PATTERNS, ...BANK_PATTERNS].flatMap((pattern) => [pattern, mirrorChallenge(pattern)]);
function challengeRandom(seed, index, channel) {
  let value = (seed ^ Math.imul(index + 1, 2654435761) ^ Math.imul(channel + 1, 2246822507)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 2146121005);
  value = Math.imul(value ^ value >>> 15, 2221713035);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}
function challengeBand(index) {
  return index < 7 ? "intro" : index < 15 ? "mixed" : "expert";
}
var THREE_SHOT_BLOCKS = [
  ["arc", "bank", "timing"],
  ["timing", "arc", "bank"],
  ["reverse", "bank", "timing"],
  ["bank", "reverse", "timing"],
  ["reverse", "arc", "bank"],
  ["arc", "reverse", "bank"]
];
var FOUR_SHOT_BLOCKS = [
  ["reverse", "arc", "bank", "timing"],
  ["reverse", "timing", "arc", "bank"],
  ["arc", "reverse", "bank", "timing"],
  ["bank", "reverse", "arc", "timing"],
  ["timing", "arc", "bank", "reverse"],
  ["arc", "bank", "reverse", "timing"]
];
function chooseChallenge(seed, index, entry, previousFamily, previousPatternId) {
  const band = challengeBand(index);
  const recovery = index === 6 || (index <= 14 ? index > 6 && (index - 6) % 4 === 0 : (index - 14) % 5 === 0);
  let family = "recovery";
  if (!recovery) {
    const start = index < 7 ? 3 : index < 15 ? 7 + Math.floor((index - 7) / 4) * 4 : 15 + Math.floor((index - 15) / 5) * 5;
    const blocks = index < 7 ? THREE_SHOT_BLOCKS.slice(0, 2) : index < 15 ? THREE_SHOT_BLOCKS : FOUR_SHOT_BLOCKS;
    family = blocks[Math.floor(challengeRandom(seed, start, 10) * blocks.length)][index - start];
  }
  const choices = CHALLENGE_PATTERNS.filter((pattern) => pattern.band === band && pattern.family === family && pattern.entryX.min <= entry.min + 1e-6 && pattern.entryX.max >= entry.max - 1e-6 && (family !== "arc" || pattern.id.includes(previousFamily === "timing" ? "arc-low" : "arc-high")) && (!previousPatternId.startsWith("timing-expert-") || pattern.receiver.center.x === (previousPatternId.endsWith("-mirror") ? 100 : 260)));
  if (!choices.length) throw new Error(`No validated ${band}/${family} connector for ${entry.min}..${entry.max}`);
  return choices[Math.floor(challengeRandom(seed, index, 11) * choices.length)];
}

// src/commerce/contracts.ts
var CREATIVE_TOOLS = ["bounce", "pin", "velcro", "sail", "needle", "stitch"];
var TOOL_KINDS = ["preview", "teleport", "revive", ...CREATIVE_TOOLS];
function isToolKind(value) {
  return typeof value === "string" && TOOL_KINDS.includes(value);
}
function isCreativeTool(value) {
  return typeof value === "string" && CREATIVE_TOOLS.includes(value);
}
function emptyToolInventory() {
  return { preview: 0, teleport: 0, revive: 0, bounce: 0, pin: 0, velcro: 0, sail: 0, needle: 0, stitch: 0 };
}

// src/game/launch/pickups.ts
function scheduledPickupKind(index) {
  if (index === 2 || index === 10) return "preview";
  if (index === 4) return "revive";
  if (index === 6 || index === 14) return "teleport";
  if (index >= 19 && (index - 19) % 5 === 0) {
    return ["revive", "preview", "teleport"][(index - 19) / 5 % 3];
  }
  return void 0;
}
function pickupPlacement(pattern) {
  if (pattern.family === "opening") {
    return { center: { x: pattern.entryX.min + (pattern.entryX.min > 180 ? 10 : -10), y: -50 }, radius: 14 };
  }
  const anchor = pattern.family === "bank" ? { x: pattern.entryX.min, y: 0 } : pattern.receiver.center;
  return {
    center: { x: anchor.x + (anchor.x < 180 ? -40 : 40), y: anchor.y - 15 },
    radius: 14
  };
}

// src/game/launch/toolInventory.ts
var FREE_TOOL_CAPACITY = 3;
function grantFreeTool(run, kind) {
  let replacedKind;
  if ((run.generationVersion ?? 1) >= 6) {
    const queue = run.freeToolQueue;
    if (!queue) throw new Error("Missing free tool inventory order.");
    if (queue.length === FREE_TOOL_CAPACITY) {
      replacedKind = queue.shift();
      run.inventory[replacedKind] -= 1;
    }
    queue.push(kind);
  }
  run.inventory[kind] += 1;
  return replacedKind;
}
function spendFreeTool(run, kind) {
  if (run.inventory[kind] <= 0) return false;
  if ((run.generationVersion ?? 1) >= 6) {
    const index = run.freeToolQueue?.indexOf(kind) ?? -1;
    if (index < 0) return false;
    run.freeToolQueue.splice(index, 1);
  }
  run.inventory[kind] -= 1;
  return true;
}

// src/game/launch/progression.ts
var INTRODUCED_MECHANICS = ["sway", "wind", "spring", "scissors"];
var WORLD_POCKET_INTERVAL = 20;
function worldStageForScore(pocketsCaught) {
  return Math.floor(Math.max(0, pocketsCaught) / WORLD_POCKET_INTERVAL);
}

// src/game/launch/interactiveProgression.ts
var INTERACTIVE_MECHANICS = ["hoop", "tear", "switch", "shutter"];
function obstacleBudget(score) {
  if (score <= 5) return [0, 0];
  const minimum = Math.min(5, worldStageForScore(score) + 1);
  return [minimum, minimum + 1];
}

// src/game/launch/snapshots.ts
function copyData(value) {
  if (Array.isArray(value)) return value.map(copyData);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item)]));
  }
  return value;
}
function captureEndlessWorld(run) {
  const {
    inventory: _inventory,
    freeToolQueue: _freeToolQueue,
    reviveUsed: _reviveUsed,
    previewActive: _previewActive,
    collectedPickupIds: _collectedPickupIds,
    lastCatchSnapshot: _lastCatchSnapshot,
    ...world
  } = run;
  return copyData(world);
}
function restoreEndlessWorld(run, snapshot) {
  Object.assign(run, copyData(snapshot));
}
function serializeEndlessRun(run) {
  return JSON.stringify({ version: run.generationVersion ?? 1, run }, (_key, value) => {
    if (typeof value !== "number" || Number.isFinite(value)) return value;
    if (Number.isNaN(value)) throw new Error("A run with NaN values cannot be saved.");
    return { $launchNumber: value < 0 ? "-Infinity" : "Infinity" };
  });
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function nonnegativeInteger(value) {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}
function point(value) {
  return record(value) && finite(value.x) && finite(value.y);
}
function idList(value) {
  return Array.isArray(value) && value.length <= 64 && value.every((id) => typeof id === "string");
}
var WORLD_MECHANICS = INTRODUCED_MECHANICS;
var WORLD_SECTION_FIELDS = ["worldStage", "mechanics", "introduction", "windZoneIds"];
var INTERACTIVE_SECTION_FIELDS = ["barrierIds", "switchIds"];
function validWorldSection(section2, worldStage, version) {
  const introductions = version >= 4 ? INTERACTIVE_MECHANICS : WORLD_MECHANICS;
  const allowed = [...introductions, "gate", "fray"];
  if (!nonnegativeInteger(section2.worldStage) || section2.worldStage > worldStage || !idList(section2.windZoneIds) || !Array.isArray(section2.mechanics) || section2.mechanics.length > 2 || new Set(section2.mechanics).size !== section2.mechanics.length || !section2.mechanics.every((mechanic) => allowed.includes(mechanic))) return false;
  if (version >= 4 && (section2.windZoneIds.length !== 0 || !idList(section2.barrierIds) || !idList(section2.switchIds))) return false;
  if (section2.introduction !== void 0 && (!introductions.includes(String(section2.introduction)) || section2.mechanics.length !== 1 || section2.mechanics[0] !== section2.introduction)) return false;
  const mechanics = section2.mechanics;
  return introductions.every((mechanic, index) => !mechanics.includes(mechanic) || section2.worldStage >= index + 1);
}
function validSections(world, version) {
  const progress = world.sectionProgress;
  if (!record(progress) || !nonnegativeInteger(progress.nextIndex) || !["fork", "cushion", "gate", "fray"].includes(String(progress.lastFamily)) || !Array.isArray(progress.sections) || !progress.sections.length || progress.sections.length > 8 || !record(world.room) || !Array.isArray(world.room.pockets)) return false;
  const worldStage = worldStageForScore(world.pocketsCaught);
  if (version >= 3 ? !Array.isArray(progress.introductions) || progress.introductions.length !== 4 || !progress.introductions.every((count, index) => nonnegativeInteger(count) && count <= 3 && (index < worldStage || count === 0)) : progress.introductions !== void 0) return false;
  const pockets = world.room.pockets;
  const nextIndex = progress.nextIndex;
  const pocketById = new Map(pockets.map((pocket2) => [pocket2.id, pocket2]));
  if (!progress.sections.every((section2) => record(section2) && typeof section2.id === "string" && nonnegativeInteger(section2.index) && section2.index < nextIndex && typeof section2.patternId === "string" && ["fork", "cushion", "gate", "fray"].includes(String(section2.family)) && nonnegativeInteger(section2.startRank) && nonnegativeInteger(section2.endRank) && section2.startRank >= 3 && section2.endRank > section2.startRank && section2.endRank - section2.startRank <= 2 && typeof section2.cue === "string" && typeof section2.entryPocketId === "string" && typeof section2.exitPocketId === "string" && idList(section2.pocketIds) && idList(section2.bumperIds) && idList(section2.hazardIds) && idList(section2.pickupIds) && Array.isArray(section2.connections) && section2.connections.length <= 32 && section2.connections.every((edge) => record(edge) && typeof edge.from === "string" && typeof edge.to === "string") && (version >= 3 ? validWorldSection(section2, worldStage, version) : WORLD_SECTION_FIELDS.every((key) => section2[key] === void 0)) && (version >= 4 || INTERACTIVE_SECTION_FIELDS.every((key) => section2[key] === void 0)))) return false;
  const sections = progress.sections;
  const claimed = {
    pocketIds: /* @__PURE__ */ new Set(),
    bumperIds: /* @__PURE__ */ new Set(),
    hazardIds: /* @__PURE__ */ new Set(),
    pickupIds: /* @__PURE__ */ new Set(),
    windZoneIds: /* @__PURE__ */ new Set(),
    barrierIds: /* @__PURE__ */ new Set(),
    switchIds: /* @__PURE__ */ new Set()
  };
  const objectIds = {
    pocketIds: new Set(pockets.map((pocket2) => String(pocket2.id))),
    bumperIds: new Set(world.room.bumpers.map((bumper) => String(bumper.id))),
    hazardIds: new Set(world.room.hazards.map((hazard) => String(hazard.id))),
    pickupIds: new Set((world.room.pickups ?? []).map((pickup) => String(pickup.id))),
    windZoneIds: new Set((world.room.windZones ?? []).map((zone) => String(zone.id))),
    barrierIds: new Set((world.room.barriers ?? []).map((barrier2) => String(barrier2.id))),
    switchIds: new Set((world.room.switches ?? []).map((button) => String(button.id)))
  };
  const collected = record(world.state) && idList(world.state.pickupIds) ? world.state.pickupIds : [];
  if (new Set(collected).size !== collected.length) return false;
  for (const [index, section2] of sections.entries()) {
    const previous = sections[index - 1];
    if (section2.id !== `section-${section2.index}` || previous && (previous.index >= section2.index || previous.endRank >= section2.startRank)) return false;
    if (version >= 3 && previous && previous.worldStage > section2.worldStage) return false;
    if (section2.index === 0 && (section2.startRank !== 3 || section2.entryPocketId !== "endless-2")) return false;
    if (previous?.index === section2.index - 1 && (section2.startRank !== previous.endRank + 1 || section2.entryPocketId !== previous.exitPocketId)) return false;
    for (const key of ["pocketIds", "bumperIds", "hazardIds", "pickupIds", "windZoneIds", "barrierIds", "switchIds"]) {
      for (const id of section2[key] ?? []) {
        if (!id.startsWith(`${section2.id}-`) || claimed[key].has(id) || !objectIds[key].has(id) && !(key === "pickupIds" && collected.includes(id))) return false;
        claimed[key].add(id);
      }
    }
    for (const id of section2.pocketIds) {
      const pocket2 = pocketById.get(id);
      if (pocket2.sectionId !== section2.id || !finite(pocket2.ascentRank) || pocket2.ascentRank < section2.startRank || pocket2.ascentRank > section2.endRank) return false;
    }
    if (!section2.pocketIds.includes(section2.exitPocketId) || pocketById.get(section2.exitPocketId).ascentRank !== section2.endRank) return false;
    const entry = pocketById.get(section2.entryPocketId);
    if (entry && entry.ascentRank !== section2.startRank - 1) return false;
    const edges = /* @__PURE__ */ new Set();
    for (const edge of section2.connections) {
      const edgeId = `${edge.from}:${edge.to}`;
      if (edges.has(edgeId) || !section2.pocketIds.includes(edge.to) || edge.from !== section2.entryPocketId && !section2.pocketIds.includes(edge.from)) return false;
      edges.add(edgeId);
      const fromRank = edge.from === section2.entryPocketId ? section2.startRank - 1 : pocketById.get(edge.from).ascentRank;
      if (!finite(fromRank) || pocketById.get(edge.to).ascentRank !== fromRank + 1) return false;
    }
    if (section2.pocketIds.some((id) => !section2.connections.some((edge) => edge.to === id) || id !== section2.exitPocketId && !section2.connections.some((edge) => edge.from === id))) return false;
    if (version === 3) {
      const mechanics = section2.mechanics;
      const ownedPockets = section2.pocketIds.map((id) => pocketById.get(id));
      const ownedBumpers = world.room.bumpers.filter((bumper) => section2.bumperIds.includes(String(bumper.id)));
      const ownedHazards = world.room.hazards.filter((hazard) => section2.hazardIds.includes(String(hazard.id)));
      if (ownedPockets.some((pocket2) => pocket2.motion !== void 0) && !mechanics.includes("sway") || ownedPockets.some((pocket2) => pocket2.frayTicks !== void 0) !== mechanics.includes("fray") || ownedBumpers.some((bumper) => bumper.springSpeed !== void 0) !== mechanics.includes("spring") || ownedHazards.some((hazard) => hazard.visual === "scissors") !== mechanics.includes("scissors") || ownedHazards.some((hazard) => hazard.motion !== void 0 && hazard.visual !== "scissors") !== mechanics.includes("gate") || section2.windZoneIds.length > 0 !== mechanics.includes("wind")) return false;
      if (mechanics.length > 1 && WORLD_MECHANICS.some((mechanic, index2) => mechanics.includes(mechanic) && progress.introductions[index2] < 3)) return false;
    }
    if (version >= 4) {
      const mechanics = section2.mechanics;
      const ownedPockets = section2.pocketIds.map((id) => pocketById.get(id));
      const ownedBarriers = world.room.barriers.filter((barrier2) => section2.barrierIds.includes(String(barrier2.id)));
      const ownedSwitches = world.room.switches.filter((button) => section2.switchIds.includes(String(button.id)));
      const ownedHazards = world.room.hazards.filter((hazard) => section2.hazardIds.includes(String(hazard.id)));
      if (ownedPockets.some((pocket2) => pocket2.orbit !== void 0) !== mechanics.includes("hoop") || ownedPockets.some((pocket2) => pocket2.frayTicks !== void 0) !== mechanics.includes("fray") || ownedHazards.some((hazard) => hazard.motion !== void 0) !== mechanics.includes("gate") || ownedBarriers.some((barrier2) => barrier2.kind === "tearable") !== mechanics.includes("tear") || ownedBarriers.some((barrier2) => barrier2.kind === "shutter") !== mechanics.includes("shutter") || ownedSwitches.length > 0 !== mechanics.includes("switch")) return false;
      const doors = new Set(ownedBarriers.filter((barrier2) => barrier2.kind === "door").map((barrier2) => String(barrier2.id)));
      const linkedDoors = /* @__PURE__ */ new Set();
      for (const button of ownedSwitches) {
        if (button.pocketId !== void 0 && !section2.pocketIds.includes(String(button.pocketId))) return false;
        for (const id of button.doorIds) {
          if (!doors.has(id)) return false;
          linkedDoors.add(id);
        }
      }
      if ([...doors].some((id) => !linkedDoors.has(id))) return false;
      if (mechanics.length > 1 && INTERACTIVE_MECHANICS.some((mechanic, index2) => mechanics.includes(mechanic) && progress.introductions[index2] < 3)) return false;
    }
  }
  const opening2 = pockets.filter((pocket2) => pocket2.sectionId === "opening");
  if (opening2.length !== 0 && (opening2.length !== 3 || opening2.some((pocket2) => !nonnegativeInteger(pocket2.ascentRank) || pocket2.ascentRank > 2 || pocket2.id !== `endless-${pocket2.ascentRank}`))) return false;
  if (pockets.some((pocket2) => pocket2.sectionId !== "opening" && !claimed.pocketIds.has(String(pocket2.id)))) return false;
  if (opening2.length) {
    claimed.pickupIds.add("opening-preview");
    if (!objectIds.pickupIds.has("opening-preview") && !collected.includes("opening-preview")) return false;
  }
  for (const key of ["bumperIds", "hazardIds", "pickupIds", "windZoneIds", "barrierIds", "switchIds"]) {
    if ([...objectIds[key]].some((id) => !claimed[key].has(id))) return false;
  }
  if (collected.some((id) => !claimed.pickupIds.has(id) || objectIds.pickupIds.has(id))) return false;
  if (version >= 3 && (version >= 4 ? INTERACTIVE_MECHANICS : WORLD_MECHANICS).some((mechanic, index) => sections.filter((section2) => section2.introduction === mechanic).length > progress.introductions[index])) return false;
  const last = sections[sections.length - 1];
  return progress.nextIndex === last.index + 1 && progress.lastFamily === last.family && world.nextPocketIndex === last.endRank + 1 && world.lastPatternId === last.patternId && world.lastGeneratedY === pocketById.get(last.exitPocketId).center.y;
}
function validWindZones(value) {
  if (!Array.isArray(value) || value.length > 64 || !value.every((zone) => record(zone) && typeof zone.id === "string" && finite(zone.x) && finite(zone.y) && finite(zone.width) && zone.width > 0 && finite(zone.height) && zone.height > 0 && finite(zone.x + zone.width) && finite(zone.y + zone.height) && finite(zone.accelerationX) && Math.abs(zone.accelerationX) <= 120)) return false;
  if (new Set(value.map((zone) => zone.id)).size !== value.length) return false;
  return value.every((zone, index) => value.slice(index + 1).every((other) => zone.x >= other.x + other.width || zone.x + zone.width <= other.x || zone.y >= other.y + other.height || zone.y + zone.height <= other.y));
}
function uniqueIds(value) {
  return idList(value) && new Set(value).size === value.length;
}
function validToolState(room, state, version) {
  const fields = ["toolEffects", "toolPhaseOffsets", "stitchedPocket", "stitchUsedSinceAuthored"];
  if (version < 5) return fields.every((key) => state[key] === void 0);
  if (state.stitchUsedSinceAuthored !== void 0 && typeof state.stitchUsedSinceAuthored !== "boolean") return false;
  const pockets = room.pockets;
  const hazards = room.hazards;
  const barriers = room.barriers ?? [];
  const moving = (id) => pockets.some((pocket2) => pocket2.id === id && (pocket2.motion || pocket2.orbit)) || hazards.some((hazard) => hazard.id === id && hazard.motion) || barriers.some((barrier2) => barrier2.id === id && barrier2.kind === "shutter");
  const exactKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
  const integerPoint = (value) => record(value) && exactKeys(value, ["x", "y"]) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
  const offsets = state.toolPhaseOffsets;
  if (offsets !== void 0 && (!record(offsets) || Object.keys(offsets).length > 128 || !Object.entries(offsets).every(([id, ticks]) => moving(id) && nonnegativeInteger(ticks) && finite(state.tick) && ticks <= state.tick))) return false;
  let stitchedId;
  if (state.stitchedPocket !== void 0) {
    const stitch = state.stitchedPocket;
    if (!record(stitch) || !exactKeys(stitch, ["pocket", "spent", "originPocketId"]) || typeof stitch.spent !== "boolean" || typeof stitch.originPocketId !== "string" || !pockets.some((pocket3) => pocket3.id === stitch.originPocketId) || !record(stitch.pocket)) return false;
    const pocket2 = stitch.pocket;
    if (!exactKeys(pocket2, ["id", "center", "width", "kind"]) || typeof pocket2.id !== "string" || !pocket2.id.startsWith("tool-stitch-") || pocket2.id.length > 160 || pockets.some((item) => item.id === pocket2.id) || !integerPoint(pocket2.center) || pocket2.width !== 80 || pocket2.kind !== "checkpoint" || stitch.spent && state.pocketId !== pocket2.id || stitch.spent && state.phase === "held") return false;
    stitchedId = pocket2.id;
  }
  const effects = state.toolEffects;
  if (effects === void 0) return true;
  if (!record(effects) || !exactKeys(effects, ["bounce", "pin", "velcro", "sail", "needle"])) return false;
  if (effects.bounce !== void 0 && (!record(effects.bounce) || !exactKeys(effects.bounce, ["position", "angle", "spent"]) || !integerPoint(effects.bounce.position) || !nonnegativeInteger(effects.bounce.angle) || effects.bounce.angle >= 180 || typeof effects.bounce.spent !== "boolean")) return false;
  if (effects.pin !== void 0 && (!record(effects.pin) || !exactKeys(effects.pin, ["targetId", "startedTick"]) || typeof effects.pin.targetId !== "string" || !moving(effects.pin.targetId) || !nonnegativeInteger(effects.pin.startedTick) || !finite(state.tick) || effects.pin.startedTick > state.tick || record(offsets) && Number(offsets[effects.pin.targetId] ?? 0) > effects.pin.startedTick)) return false;
  if (effects.velcro !== void 0 && (!record(effects.velcro) || !exactKeys(effects.velcro, ["targetId"]) || typeof effects.velcro.targetId !== "string" || !pockets.some((pocket2) => pocket2.id === effects.velcro.targetId) && effects.velcro.targetId !== stitchedId)) return false;
  if (effects.sail !== void 0 && effects.sail !== true) return false;
  if (effects.needle !== void 0 && (!record(effects.needle) || !exactKeys(effects.needle, ["piercedId"]) || effects.needle.piercedId !== void 0 && (typeof effects.needle.piercedId !== "string" || !hazards.some((hazard) => hazard.id === effects.needle.piercedId && hazard.visual !== "scissors") && !barriers.some((barrier2) => barrier2.id === effects.needle.piercedId && barrier2.kind === "thorns")))) return false;
  return true;
}
function validInteractiveState(room, state) {
  if (!Array.isArray(room.barriers) || room.barriers.length > 64 || !room.barriers.every((barrier2) => record(barrier2) && typeof barrier2.id === "string" && finite(barrier2.x) && finite(barrier2.y) && finite(barrier2.width) && barrier2.width > 0 && finite(barrier2.height) && barrier2.height > 0 && finite(barrier2.x + barrier2.width) && finite(barrier2.y + barrier2.height) && ["solid", "tearable", "door", "thorns", "shutter"].includes(String(barrier2.kind)) && (barrier2.phaseTicks === void 0 || nonnegativeInteger(barrier2.phaseTicks) && barrier2.phaseTicks < 480))) return false;
  if (!Array.isArray(room.switches) || room.switches.length > 64 || !room.switches.every((button) => record(button) && typeof button.id === "string" && point(button.center) && finite(button.radius) && button.radius > 0 && button.radius <= 80 && uniqueIds(button.doorIds) && button.doorIds.length > 0 && (button.pocketId === void 0 || typeof button.pocketId === "string"))) return false;
  const ids = ["pockets", "bumpers", "hazards", "pickups", "barriers", "switches"].flatMap((key) => (room[key] ?? []).map((item) => item.id));
  if (new Set(ids).size !== ids.length) return false;
  if (!uniqueIds(state.brokenBarrierIds) || !uniqueIds(state.activatedSwitchIds)) return false;
  const barriers = room.barriers;
  const switches = room.switches;
  return state.brokenBarrierIds.every((id) => barriers.some((barrier2) => barrier2.id === id && barrier2.kind === "tearable")) && state.activatedSwitchIds.every((id) => switches.some((button) => button.id === id));
}
function validWorld(value, version) {
  if (!record(value) || !record(value.room) || !record(value.state)) return false;
  const { room, state } = value;
  if (version >= 2 ? value.generationVersion !== version : value.generationVersion !== void 0 && value.generationVersion !== 1) return false;
  if (!record(room.bounds) || room.bounds.width !== 360 || room.bounds.height !== 600 || !finite(room.gravity) || !finite(value.cameraY) || !nonnegativeInteger(value.seed) || !nonnegativeInteger(value.highestPocket) || !nonnegativeInteger(value.pocketsCaught) || !finite(value.height) || !nonnegativeInteger(value.nextPocketIndex) || !finite(value.lastGeneratedY) || typeof value.nextPocketId !== "string" || typeof value.lastPatternId !== "string" || !record(value.lastExitX) || !finite(value.lastExitX.min) || !finite(value.lastExitX.max) || value.nextPocketIndex <= value.highestPocket || value.nextPocketIndex > value.highestPocket + (version >= 2 ? 9 : 6) || value.pocketsCaught > value.highestPocket || value.lastExitX.min > value.lastExitX.max || !["opening", "recovery", "arc", "bank", "reverse", "timing"].includes(String(value.lastFamily)) || !Array.isArray(value.challenges) || value.challenges.length > 32 || !value.challenges.every((challenge) => record(challenge) && nonnegativeInteger(challenge.index) && typeof challenge.pocketId === "string" && typeof challenge.patternId === "string" && idList(challenge.bumperIds) && idList(challenge.hazardIds) && idList(challenge.pickupIds))) return false;
  if (room.bounds.top !== Number.NEGATIVE_INFINITY && !finite(room.bounds.top)) return false;
  if (!finite(room.bounds.bottom)) return false;
  if (room.sideWallRestitution !== void 0 && (!finite(room.sideWallRestitution) || room.sideWallRestitution < 0 || room.sideWallRestitution > 1)) return false;
  if (!Array.isArray(room.pockets) || !room.pockets.length || room.pockets.length > 32 || !room.pockets.every((pocket2) => record(pocket2) && typeof pocket2.id === "string" && point(pocket2.center) && finite(pocket2.width) && pocket2.width > 0 && ["start", "checkpoint", "goal"].includes(String(pocket2.kind)) && (version < 2 || typeof pocket2.sectionId === "string" && nonnegativeInteger(pocket2.ascentRank)) && (pocket2.route === void 0 || ["safe", "reward", "recovery"].includes(String(pocket2.route))) && (pocket2.frayTicks === void 0 || nonnegativeInteger(pocket2.frayTicks) && pocket2.frayTicks > 0) && (pocket2.motion === void 0 || version < 4 && record(pocket2.motion) && finite(pocket2.motion.amplitude) && finite(pocket2.motion.periodTicks) && pocket2.motion.periodTicks > 0 && finite(pocket2.motion.phaseTicks)) && (pocket2.orbit === void 0 || version >= 4 && record(pocket2.orbit) && finite(pocket2.orbit.radius) && pocket2.orbit.radius > 0 && pocket2.orbit.radius <= 80 && finite(pocket2.orbit.periodTicks) && pocket2.orbit.periodTicks >= 120 && finite(pocket2.orbit.phaseTicks) && (pocket2.orbit.direction === void 0 || pocket2.orbit.direction === 1 || pocket2.orbit.direction === -1)))) return false;
  for (const key of ["bumpers", "hazards", "pickups"]) {
    const objects = room[key];
    if (key === "pickups" && objects === void 0) continue;
    if (!Array.isArray(objects) || objects.length > 64 || !objects.every((object) => record(object) && typeof object.id === "string" && point(object.center) && finite(object.radius) && object.radius > 0 && (key !== "bumpers" || finite(object.restitution) && (object.springSpeed === void 0 || version === 3 && finite(object.springSpeed) && object.springSpeed > 0 && object.springSpeed <= 850)) && (key !== "hazards" || object.visual === void 0 || version === 3 && object.visual === "scissors") && (key !== "hazards" || object.motion === void 0 || record(object.motion) && finite(object.motion.amplitude) && finite(object.motion.phaseTicks) && finite(object.motion.periodTicks) && object.motion.periodTicks > 0 && (object.motion.axis === void 0 || ["x", "y"].includes(String(object.motion.axis)))) && (key !== "pickups" || (version >= 5 ? isToolKind(object.kind) : ["preview", "teleport", "revive"].includes(String(object.kind)))))) return false;
    if (version >= 2 && new Set(objects.map((object) => object.id)).size !== objects.length) return false;
  }
  if (version === 3 ? !validWindZones(room.windZones) : version >= 4 ? room.windZones !== void 0 && (!Array.isArray(room.windZones) || room.windZones.length !== 0) : room.windZones !== void 0) return false;
  if (version >= 4 ? !validInteractiveState(room, state) : room.barriers !== void 0 || room.switches !== void 0 || state.brokenBarrierIds !== void 0 || state.activatedSwitchIds !== void 0) return false;
  if (version === 1 && record(value.sectionProgress) && (value.sectionProgress.introductions !== void 0 || Array.isArray(value.sectionProgress.sections) && value.sectionProgress.sections.some((section2) => record(section2) && [...WORLD_SECTION_FIELDS, ...INTERACTIVE_SECTION_FIELDS].some((key) => section2[key] !== void 0)))) return false;
  const checkedPockets = room.pockets;
  if (new Set(room.pockets.map((pocket2) => pocket2.id)).size !== room.pockets.length) return false;
  if (state.pocketExpiryTicks !== void 0 && (!record(state.pocketExpiryTicks) || Object.keys(state.pocketExpiryTicks).length > 32 || !Object.entries(state.pocketExpiryTicks).every(([id, expiry]) => nonnegativeInteger(expiry) && checkedPockets.some((pocket2) => pocket2.id === id && finite(pocket2.frayTicks))))) return false;
  if (!validToolState(room, state, version)) return false;
  if (state.frayedFall !== void 0 && typeof state.frayedFall !== "boolean") return false;
  if (version >= 2 && !validSections(value, version)) return false;
  if (version >= 2) {
    const current = checkedPockets.find((pocket2) => pocket2.id === state.pocketId);
    if (current?.frayTicks !== void 0) {
      const expiry = record(state.pocketExpiryTicks) ? state.pocketExpiryTicks[String(state.pocketId)] : void 0;
      if (!nonnegativeInteger(expiry) || finite(state.tick) && finite(current.frayTicks) && (expiry > state.tick + current.frayTicks || state.phase === "held" && expiry <= state.tick)) return false;
    }
  }
  return nonnegativeInteger(state.tick) && ["held", "flying", "failed", "complete"].includes(String(state.phase)) && point(state.position) && point(state.previousPosition) && point(state.velocity) && typeof state.pocketId === "string" && (room.pockets.some((pocket2) => pocket2.id === state.pocketId) || record(state.stitchedPocket) && record(state.stitchedPocket.pocket) && state.stitchedPocket.pocket.id === state.pocketId) && nonnegativeInteger(state.flightTicks) && nonnegativeInteger(state.launches) && record(state.checkpoint) && typeof state.checkpoint.pocketId === "string" && nonnegativeInteger(state.checkpoint.tick) && idList(state.pickupIds) && typeof state.patchCollected === "boolean" && typeof state.checkpoint.patchCollected === "boolean" && typeof state.sourcePocketImmune === "boolean";
}
function deserializeEndlessRun(serialized) {
  try {
    const payload = JSON.parse(serialized, (_key, value) => {
      if (record(value) && Object.keys(value).length === 1) {
        if (value.$launchNumber === "-Infinity") return Number.NEGATIVE_INFINITY;
        if (value.$launchNumber === "Infinity") return Number.POSITIVE_INFINITY;
      }
      return value;
    });
    if (!record(payload) || payload.version !== 1 && payload.version !== 2 && payload.version !== 3 && payload.version !== 4 && payload.version !== 5 && payload.version !== 6 || !validWorld(payload.run, payload.version) || !record(payload.run)) return null;
    const run = payload.run;
    const inventory = run.inventory;
    if (!record(inventory) || !["preview", "teleport", "revive"].every((kind) => nonnegativeInteger(inventory[kind])) || typeof run.reviveUsed !== "boolean" || typeof run.previewActive !== "boolean" || !idList(run.collectedPickupIds) || !validWorld(run.lastCatchSnapshot, payload.version)) return null;
    for (const kind of CREATIVE_TOOLS) {
      if (payload.version < 5 && inventory[kind] === void 0) inventory[kind] = 0;
      if (!nonnegativeInteger(inventory[kind]) || payload.version < 5 && inventory[kind] !== 0) return null;
    }
    if (Object.keys(inventory).some((kind) => !isToolKind(kind))) return null;
    if (payload.version >= 6) {
      const queue = run.freeToolQueue;
      if (!Array.isArray(queue) || queue.length > FREE_TOOL_CAPACITY || !queue.every(isToolKind) || Object.entries(inventory).some(([kind, count]) => queue.filter((entry) => entry === kind).length !== count)) return null;
    } else if (run.freeToolQueue !== void 0) return null;
    const checkpoint = run.lastCatchSnapshot;
    if (!record(checkpoint) || ["inventory", "freeToolQueue", "reviveUsed", "previewActive", "collectedPickupIds", "lastCatchSnapshot"].some((key) => key in checkpoint)) return null;
    if (payload.version >= 5 && record(checkpoint.state) && record(checkpoint.state.toolEffects) && Object.keys(checkpoint.state.toolEffects).length) return null;
    if (record(run.room) && record(checkpoint.room) && run.room.sideWallRestitution !== checkpoint.room.sideWallRestitution) return null;
    if (payload.version >= 2) {
      const collected = run.collectedPickupIds;
      const stateCollected = run.state.pickupIds;
      const checkpointCollected = checkpoint.state.pickupIds;
      if (new Set(collected).size !== collected.length || collected.length !== stateCollected.length || stateCollected.some((id) => !collected.includes(id)) || checkpointCollected.some((id) => !collected.includes(id))) return null;
    }
    if (payload.version >= 3) {
      const progress = run.sectionProgress;
      const checkpointProgress = checkpoint.sectionProgress;
      if (run.seed !== checkpoint.seed || checkpoint.pocketsCaught > run.pocketsCaught || checkpoint.highestPocket > run.highestPocket || checkpointProgress.nextIndex > progress.nextIndex || checkpointProgress.introductions.some((count, index) => count > progress.introductions[index])) return null;
    }
    if (payload.version >= 4) {
      const currentState = run.state;
      const checkpointState = checkpoint.state;
      if (["brokenBarrierIds", "activatedSwitchIds"].some((key) => checkpointState[key].some((id) => !currentState[key].includes(id)))) return null;
    }
    return run;
  } catch {
    return null;
  }
}

// src/game/launch/sections.ts
var pocket = (id, x, y, ascentRank, route, width = route === "reward" ? 76 : route === "recovery" ? 144 : 116, frayTicks) => ({ id, center: { x, y }, ascentRank, route, width, frayTicks, kind: "checkpoint" });
var links = (...pairs) => pairs.map(([from, to]) => ({ from, to }));
var gift = (x, y, kind = "preview") => ({ id: "gift", kind, center: { x, y }, radius: 17 });
var cushion = (id, x, y, radius = 30) => ({ id, center: { x, y }, radius, restitution: 0.98 });
var gate = (id, x, y, amplitude, periodTicks, phaseTicks = 0) => ({ id, center: { x, y }, radius: 14, motion: { axis: "x", amplitude, periodTicks, phaseTicks } });
var section = (id, family, pockets, connections, extras, cue) => ({
  id,
  family,
  entryX: { min: 100, max: 260 },
  exitX: { min: 180, max: 180 },
  pockets,
  connections,
  exitPocketId: "rest",
  bumpers: [],
  hazards: [],
  pickups: [],
  ...extras,
  cue
});
var SECTION_PATTERNS = [
  section(
    "fork-lanes",
    "fork",
    [
      pocket("safe", 98, -125, 1, "safe"),
      pocket("reward", 264, -125, 1, "reward"),
      pocket("safe-upper", 105, -255, 2, "safe"),
      pocket("reward-upper", 255, -270, 2, "reward"),
      pocket("rest", 180, -405, 3, "recovery")
    ],
    links(
      ["entry", "safe"],
      ["entry", "reward"],
      ["safe", "safe-upper"],
      ["reward", "reward-upper"],
      ["safe-upper", "rest"],
      ["reward-upper", "rest"]
    ),
    { pickups: [gift(255, -294)] },
    "Choose the roomy pockets, or follow the narrow lane for a free tool."
  ),
  section(
    "fork-bridge",
    "fork",
    [
      pocket("safe", 98, -130, 1, "safe"),
      pocket("reward", 264, -155, 1, "reward"),
      pocket("bridge", 180, -285, 2, "safe", 124),
      pocket("rest", 180, -415, 3, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "bridge"], ["reward", "bridge"], ["bridge", "rest"]),
    { pickups: [gift(264, -179, "teleport")] },
    "Two routes meet at the wide stitched bridge."
  ),
  section(
    "fork-crossing",
    "fork",
    [
      pocket("safe", 96, -140, 1, "safe"),
      pocket("reward", 262, -115, 1, "reward"),
      pocket("safe-upper", 252, -280, 2, "safe"),
      pocket("reward-upper", 96, -260, 2, "reward"),
      pocket("rest", 180, -410, 3, "recovery")
    ],
    links(
      ["entry", "safe"],
      ["entry", "reward"],
      ["safe", "safe-upper"],
      ["reward", "reward-upper"],
      ["safe-upper", "rest"],
      ["reward-upper", "rest"]
    ),
    { pickups: [gift(96, -284)] },
    "Cross the threads: a long diagonal leads to the next landing."
  ),
  section(
    "cushion-side-return",
    "cushion",
    [
      pocket("safe", 96, -135, 1, "safe"),
      pocket("reward", 260, -160, 1, "reward", 88),
      pocket("rest", 180, -310, 2, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "rest"], ["reward", "rest"]),
    { bumpers: [cushion("side", 338, -202, 27)], pickups: [gift(266, -184)] },
    "The side cushion can bounce you back into the reward pocket."
  ),
  section(
    "cushion-stair",
    "cushion",
    [
      pocket("safe", 95, -125, 1, "safe"),
      pocket("reward", 258, -145, 1, "reward", 84),
      pocket("safe-upper", 98, -270, 2, "safe"),
      pocket("reward-upper", 260, -300, 2, "reward", 92),
      pocket("rest", 180, -445, 3, "recovery")
    ],
    links(
      ["entry", "safe"],
      ["entry", "reward"],
      ["safe", "safe-upper"],
      ["reward", "reward-upper"],
      ["safe-upper", "rest"],
      ["reward-upper", "rest"]
    ),
    { bumpers: [cushion("lower", 339, -191, 25), cushion("upper", 337, -346, 26)], pickups: [gift(260, -324, "teleport")] },
    "Follow the cushion staircase, or climb the wide pockets on the other side."
  ),
  section(
    "cushion-switchback",
    "cushion",
    [
      pocket("safe", 98, -130, 1, "safe"),
      pocket("reward", 258, -150, 1, "reward", 84),
      pocket("bridge", 103, -290, 2, "safe", 128),
      pocket("rest", 180, -435, 3, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "bridge"], ["reward", "bridge"], ["bridge", "rest"]),
    { bumpers: [cushion("return", 337, -195, 27), cushion("opposite", 21, -331, 25)], pickups: [gift(258, -174)] },
    "Bounce toward the first reward, then turn toward the opposite cushion."
  ),
  section(
    "gate-open-window",
    "gate",
    [
      pocket("safe", 98, -120, 1, "safe"),
      pocket("reward", 264, -120, 1, "reward"),
      pocket("rest", 180, -390, 2, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "rest"], ["reward", "rest"]),
    { hazards: [gate("window", 230, -253, 45, 420)], pickups: [gift(264, -144, "teleport")] },
    "Take a deep pull. Wait for the moving thorns to open your route."
  ),
  section(
    "gate-two-lanes",
    "gate",
    [
      pocket("safe", 94, -125, 1, "safe"),
      pocket("reward", 265, -125, 1, "reward"),
      pocket("safe-upper", 94, -390, 2, "safe"),
      pocket("reward-upper", 265, -390, 2, "reward"),
      pocket("rest", 180, -525, 3, "recovery")
    ],
    links(
      ["entry", "safe"],
      ["entry", "reward"],
      ["safe", "safe-upper"],
      ["reward", "reward-upper"],
      ["safe-upper", "rest"],
      ["reward-upper", "rest"]
    ),
    { hazards: [gate("sweep", 250, -258, 62, 480, 80)], pickups: [gift(265, -414)] },
    "The wide lane is roomy. Time the thorn sweep for the tool above."
  ),
  section(
    "gate-diagonal",
    "gate",
    [
      pocket("safe", 100, -125, 1, "safe"),
      pocket("reward", 264, -125, 1, "reward"),
      pocket("bridge", 100, -390, 2, "safe", 128),
      pocket("rest", 180, -525, 3, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "bridge"], ["reward", "bridge"], ["bridge", "rest"]),
    { hazards: [gate("crossbar", 242, -258, 48, 540, 160)], pickups: [gift(264, -149)] },
    "Watch the moving crossbar before taking the long diagonal."
  ),
  section(
    "fray-shortcut",
    "fray",
    [
      pocket("safe", 98, -120, 1, "safe"),
      pocket("reward", 264, -150, 1, "reward", 76, 480),
      pocket("rest", 180, -290, 2, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "rest"], ["reward", "rest"]),
    { pickups: [gift(264, -174, "teleport")] },
    "Loose stitches last four seconds after landing. The wide route has no timer."
  ),
  section(
    "fray-bridge",
    "fray",
    [
      pocket("safe", 98, -130, 1, "safe"),
      pocket("reward", 264, -130, 1, "reward", 76, 480),
      pocket("bridge", 180, -260, 2, "safe", 124),
      pocket("rest", 180, -390, 3, "recovery")
    ],
    links(["entry", "safe"], ["entry", "reward"], ["safe", "bridge"], ["reward", "bridge"], ["bridge", "rest"]),
    { pickups: [gift(264, -154)] },
    "Grab the gift on the loose pocket, then reach the untimed bridge."
  ),
  section(
    "fray-relay",
    "fray",
    [
      pocket("safe", 98, -125, 1, "safe"),
      pocket("reward", 264, -125, 1, "reward"),
      pocket("safe-upper", 104, -255, 2, "safe"),
      pocket("reward-upper", 255, -275, 2, "reward", 76, 480),
      pocket("rest", 180, -415, 3, "recovery")
    ],
    links(
      ["entry", "safe"],
      ["entry", "reward"],
      ["safe", "safe-upper"],
      ["reward", "reward-upper"],
      ["safe-upper", "rest"],
      ["reward-upper", "rest"]
    ),
    { pickups: [gift(255, -299, "teleport")] },
    "Choose your lane first. The second reward pocket starts a four-second countdown."
  )
];
function mirrorSection(pattern) {
  const mirror = (point2) => ({ x: 360 - point2.x, y: point2.y });
  return {
    ...pattern,
    id: `${pattern.id}-mirror`,
    entryX: { min: 360 - pattern.entryX.max, max: 360 - pattern.entryX.min },
    exitX: { min: 360 - pattern.exitX.max, max: 360 - pattern.exitX.min },
    pockets: pattern.pockets.map((value) => ({
      ...value,
      center: mirror(value.center),
      motion: value.motion ? { ...value.motion, amplitude: -value.motion.amplitude } : void 0
    })),
    bumpers: pattern.bumpers.map((value) => ({ ...value, center: mirror(value.center) })),
    hazards: pattern.hazards.map((value) => ({
      ...value,
      center: mirror(value.center),
      motion: value.motion ? { ...value.motion, amplitude: value.motion.axis === "y" ? value.motion.amplitude : -value.motion.amplitude } : void 0
    })),
    pickups: pattern.pickups.map((value) => ({ ...value, center: mirror(value.center) }))
  };
}
function randomWord(seed, index) {
  let word = (seed ^ Math.imul(index + 1, 2654435769)) >>> 0;
  word = Math.imul(word ^ word >>> 16, 2246822507);
  word = Math.imul(word ^ word >>> 13, 3266489909);
  return (word ^ word >>> 16) >>> 0;
}
function chooseSection(seed, index, entry, previousFamily, allowFray) {
  const teaching = ["fork", "cushion", "gate"];
  const isPressure = (family) => family === "gate" || family === "fray";
  const eligible = SECTION_PATTERNS.filter((candidate) => candidate.entryX.min <= entry.min && candidate.entryX.max >= entry.max && candidate.family !== previousFamily && (candidate.family !== "fray" || allowFray) && (!previousFamily || !isPressure(previousFamily) || !isPressure(candidate.family)) && (index >= teaching.length || candidate.family === teaching[index]));
  if (!eligible.length) throw new Error(`No section accepts entry ${entry.min}..${entry.max} at ${index}`);
  const word = randomWord(seed, index);
  const selected = eligible[word % eligible.length];
  return word & 256 ? mirrorSection(selected) : selected;
}

// src/game/launch/worldSections.ts
var basic = (pattern) => ({
  ...pattern,
  mechanics: pattern.family === "gate" || pattern.family === "fray" ? [pattern.family] : [],
  windZones: []
});
function sway(pattern) {
  return {
    ...pattern,
    id: `${pattern.id}-sway`,
    mechanics: [...pattern.mechanics, "sway"],
    pockets: pattern.pockets.map((pocket2) => pocket2.route === "reward" ? {
      ...pocket2,
      width: 104,
      center: { ...pocket2.center, x: Math.min(264, Math.max(96, pocket2.center.x)) },
      motion: { amplitude: 22, periodTicks: 480, phaseTicks: 0 }
    } : pocket2)
  };
}
function windy(pattern) {
  return {
    ...pattern,
    id: `${pattern.id}-wind`,
    mechanics: [...pattern.mechanics, "wind"],
    windZones: [{ id: "ribbon", x: 210, y: -310, width: 100, height: 150, accelerationX: -100 }]
  };
}
var swayPatterns = [0, 1, 3].map((index) => ({
  ...sway(basic(SECTION_PATTERNS[index])),
  // The lesson contains only its new interaction; cushions return in mixed sections.
  bumpers: [],
  family: "fork",
  cue: "The garden pockets sway. Catch one to hold it still, or take the wide lane."
}));
var windPatterns = [0, 1, 4].map((index) => ({
  ...windy(basic(SECTION_PATTERNS[index])),
  bumpers: [],
  family: "fork",
  cue: "Wind ribbons carry your button sideways. The wide lane stays sheltered."
}));
var springPatterns = [3, 4, 5].map((index) => ({
  ...basic(SECTION_PATTERNS[index]),
  id: `${SECTION_PATTERNS[index].id}-spring`,
  mechanics: ["spring"],
  bumpers: SECTION_PATTERNS[index].bumpers.map((bumper) => ({ ...bumper, radius: 26, springSpeed: 650 })),
  cue: "Spring spools send the button bouncing farther. Try a bank, or use the wide pockets."
}));
var scissorsPatterns = [0, 80, 160].map((phaseTicks, index) => ({
  ...basic(SECTION_PATTERNS[7]),
  id: `scissors-window-${index}`,
  mechanics: ["scissors"],
  hazards: [{
    id: "scissors",
    center: { x: 250, y: -258 },
    radius: 18,
    visual: "scissors",
    motion: { axis: "x", amplitude: 34, periodTicks: 600, phaseTicks }
  }],
  cue: "Wait for the scissors to sweep past, then launch. The wide lane has no timing gate."
}));
var WORLD_SECTION_PATTERNS = [
  ...swayPatterns,
  ...windPatterns,
  ...springPatterns,
  ...scissorsPatterns,
  { ...sway(windPatterns[0]), cue: "Ride the ribbon toward a swaying landing, or climb the sheltered pockets." },
  { ...sway(springPatterns[0]), cue: "Bank off a spring toward a swaying pocket, or follow the roomy lane." },
  { ...sway(scissorsPatterns[0]), cue: "Watch the scissors and the moving landing before taking the reward lane." },
  { ...windy(basic(SECTION_PATTERNS[9])), cue: "Ride the ribbon to loose stitches, then launch again before they unravel." }
];
function mirrorWorldSection(pattern) {
  return { ...pattern, ...mirrorSection(pattern), windZones: pattern.windZones.map((zone) => ({
    ...zone,
    x: 360 - zone.x - zone.width,
    accelerationX: -zone.accelerationX
  })) };
}
function randomWord2(seed, index) {
  let word = (seed ^ Math.imul(index + 1, 2654435769)) >>> 0;
  word = Math.imul(word ^ word >>> 16, 2246822507);
  word = Math.imul(word ^ word >>> 13, 3266489909);
  return (word ^ word >>> 16) >>> 0;
}
function chooseWorldSection(seed, index, entry, previousFamily, score, introductions) {
  const stage = Math.min(4, worldStageForScore(score));
  const pending = INTRODUCED_MECHANICS.findIndex((_, mechanic) => mechanic < stage && introductions[mechanic] < 3);
  const pressureBefore = previousFamily === "gate" || previousFamily === "fray";
  const word = randomWord2(seed, index);
  if (pending !== -1 && !pressureBefore) {
    const lesson2 = WORLD_SECTION_PATTERNS[pending * 3 + introductions[pending]];
    const pattern = { ...lesson2, introduction: INTRODUCED_MECHANICS[pending] };
    return word & 256 ? mirrorWorldSection(pattern) : pattern;
  }
  const baseline = basic(chooseSection(seed, index, entry, previousFamily, score >= 12));
  if (pending !== -1 || stage === 0 || word % 3 === 0) return baseline;
  const eligible = WORLD_SECTION_PATTERNS.filter((pattern) => pattern.entryX.min <= entry.min && pattern.entryX.max >= entry.max && pattern.family !== previousFamily && (!pressureBefore || pattern.family !== "gate" && pattern.family !== "fray") && pattern.mechanics.every((mechanic) => {
    const introduced = INTRODUCED_MECHANICS.indexOf(mechanic);
    return introduced === -1 || introduced < stage && introductions[introduced] === 3;
  }));
  const combinations = eligible.filter((pattern) => pattern.mechanics.length === 2);
  const candidates = score >= 100 && word % 3 === 1 && combinations.length ? combinations : eligible;
  if (!candidates.length) return baseline;
  const selected = candidates[word % candidates.length];
  return word & 256 ? mirrorWorldSection(selected) : selected;
}

// src/game/launch/sectionWindow.ts
function updateSectionWindow(run) {
  const progress = run.sectionProgress;
  let pockets = [...run.room.pockets];
  let bumpers = [...run.room.bumpers];
  let hazards = [...run.room.hazards];
  let pickups = [...run.room.pickups ?? []];
  let windZones = [...run.room.windZones ?? []];
  if (run.nextPocketIndex === 1) {
    pockets = pockets.map((pocket2) => ({ ...pocket2, ascentRank: 0, sectionId: "opening" }));
  }
  while (run.nextPocketIndex < 3) {
    const rank = run.nextPocketIndex;
    const center = { x: rank === 1 ? 240 : 260, y: run.lastGeneratedY - (rank === 1 ? 100 : 135) };
    pockets.push({
      id: `endless-${rank}`,
      kind: "checkpoint",
      center,
      width: 144,
      ascentRank: rank,
      sectionId: "opening"
    });
    if (rank === 2) pickups.push({
      id: "opening-preview",
      kind: "preview",
      center: { x: center.x + 20, y: center.y - 45 },
      radius: 14
    });
    run.lastGeneratedY = center.y;
    run.lastExitX = { min: center.x, max: center.x };
    run.nextPocketIndex += 1;
  }
  while (run.nextPocketIndex <= run.highestPocket + 5) {
    const index = progress.nextIndex;
    const pattern = run.generationVersion === 3 ? chooseWorldSection(run.seed, index, run.lastExitX, progress.lastFamily, run.pocketsCaught, progress.introductions) : chooseSection(run.seed, index, run.lastExitX, progress.lastFamily, run.pocketsCaught >= 12);
    const worldPattern = run.generationVersion === 3 ? pattern : void 0;
    const id = `section-${index}`;
    const entryPocketId = progress.sections.at(-1)?.exitPocketId ?? "endless-2";
    const localId = (value) => value === "entry" ? entryPocketId : `${id}-${value}`;
    const translated = (point2) => ({ x: point2.x, y: point2.y + run.lastGeneratedY });
    const baseRank = run.nextPocketIndex - 1;
    const ownedPockets = pattern.pockets.map((pocket2) => ({
      ...pocket2,
      id: localId(pocket2.id),
      sectionId: id,
      ascentRank: baseRank + pocket2.ascentRank,
      center: translated(pocket2.center)
    }));
    const ownedBumpers = pattern.bumpers.map((bumper) => ({ ...bumper, id: localId(bumper.id), center: translated(bumper.center) }));
    const ownedHazards = pattern.hazards.map((hazard) => ({ ...hazard, id: localId(hazard.id), center: translated(hazard.center) }));
    const ownedWindZones = worldPattern?.windZones.map((zone) => ({ ...zone, id: localId(zone.id), y: zone.y + run.lastGeneratedY })) ?? [];
    const scheduled = ["preview", "revive", "teleport"][Math.floor(index / 2) % 3];
    const kind = scheduled === "revive" && (run.reviveUsed || run.inventory.revive > 0) ? "preview" : scheduled;
    const ownedPickups = index % 2 === 0 ? pattern.pickups.map((pickup) => ({
      ...pickup,
      kind,
      id: localId(pickup.id),
      center: translated(pickup.center)
    })) : [];
    const exit = ownedPockets.find((pocket2) => pocket2.id === localId(pattern.exitPocketId));
    const section2 = {
      id,
      index,
      patternId: pattern.id,
      family: pattern.family,
      startRank: baseRank + 1,
      endRank: exit.ascentRank,
      entryPocketId,
      exitPocketId: exit.id,
      pocketIds: ownedPockets.map((pocket2) => pocket2.id),
      bumperIds: ownedBumpers.map((bumper) => bumper.id),
      hazardIds: ownedHazards.map((hazard) => hazard.id),
      pickupIds: ownedPickups.map((pickup) => pickup.id),
      connections: pattern.connections.map((edge) => ({ from: localId(edge.from), to: localId(edge.to) })),
      cue: pattern.cue,
      ...worldPattern ? {
        worldStage: worldStageForScore(run.pocketsCaught),
        mechanics: worldPattern.mechanics,
        windZoneIds: ownedWindZones.map((zone) => zone.id),
        ...worldPattern.introduction ? { introduction: worldPattern.introduction } : {}
      } : {}
    };
    if (worldPattern?.introduction) {
      const introductions = [...progress.introductions];
      introductions[INTRODUCED_MECHANICS.indexOf(worldPattern.introduction)] += 1;
      progress.introductions = introductions;
    }
    progress.sections = [...progress.sections, section2];
    progress.nextIndex += 1;
    progress.lastFamily = pattern.family;
    pockets.push(...ownedPockets);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    pickups.push(...ownedPickups);
    windZones.push(...ownedWindZones);
    run.lastGeneratedY = exit.center.y;
    run.lastExitX = pattern.exitX;
    run.lastPatternId = pattern.id;
    run.nextPocketIndex = exit.ascentRank + 1;
  }
  const reached = progress.sections.filter((section2) => section2.startRank <= run.highestPocket).at(-1);
  const minimumIndex = (reached?.index ?? 0) - 1;
  const sourceSectionId = pockets.find((pocket2) => pocket2.id === run.state.pocketId)?.sectionId;
  progress.sections = progress.sections.filter((section2) => section2.index >= minimumIndex || section2.id === sourceSectionId);
  const retainedSections = new Set(progress.sections.map((section2) => section2.id));
  if (minimumIndex <= 0 || sourceSectionId === "opening") retainedSections.add("opening");
  const retainedPockets = pockets.filter((pocket2) => retainedSections.has(pocket2.sectionId));
  const ids = new Set(retainedPockets.map((pocket2) => pocket2.id));
  const bumperIds = new Set(progress.sections.flatMap((section2) => section2.bumperIds));
  const hazardIds = new Set(progress.sections.flatMap((section2) => section2.hazardIds));
  const pickupIds = new Set(progress.sections.flatMap((section2) => section2.pickupIds));
  const windZoneIds = new Set(progress.sections.flatMap((section2) => section2.windZoneIds ?? []));
  if (retainedSections.has("opening")) pickupIds.add("opening-preview");
  run.collectedPickupIds = run.collectedPickupIds.filter((id) => pickupIds.has(id));
  run.state.pickupIds = [...run.collectedPickupIds];
  if (run.state.pocketExpiryTicks) run.state.pocketExpiryTicks = Object.fromEntries(
    Object.entries(run.state.pocketExpiryTicks).filter(([id]) => ids.has(id))
  );
  run.room = {
    ...run.room,
    pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => bumperIds.has(bumper.id)),
    hazards: hazards.filter((hazard) => hazardIds.has(hazard.id)),
    pickups: pickups.filter((pickup) => pickupIds.has(pickup.id) && !run.collectedPickupIds.includes(pickup.id)),
    ...run.generationVersion === 3 ? { windZones: windZones.filter((zone) => windZoneIds.has(zone.id)) } : {}
  };
  const next = progress.sections.flatMap((section2) => section2.connections).find((edge) => edge.from === run.state.pocketId && ids.has(edge.to));
  run.nextPocketId = next?.to ?? (run.state.pocketId === "endless-0" ? "endless-1" : run.state.pocketId === "endless-1" ? "endless-2" : retainedPockets.find((pocket2) => pocket2.ascentRank > run.highestPocket)?.id ?? run.state.pocketId);
}

// src/game/launch/interactiveSections.ts
var barrier = (id, x, y, width, kind = "solid", phaseTicks = 0) => ({ id, x, y, width, height: 12, kind, ...kind === "shutter" ? { phaseTicks } : {} });
var receiver = (id, x, y, ascentRank, route, width = 116) => ({
  id,
  center: { x, y },
  width,
  kind: "checkpoint",
  ascentRank,
  route
});
var links2 = [
  { from: "entry", to: "left" },
  { from: "entry", to: "right" },
  { from: "left", to: "left-upper" },
  { from: "right", to: "right-upper" },
  { from: "left-upper", to: "rest" },
  { from: "right-upper", to: "rest" }
];
var upperWalls = [
  barrier("upper-middle", 122, -548, 116),
  barrier("upper-left", 0, -548, 42),
  barrier("upper-right", 318, -548, 42)
];
function layout(id, variant, mechanics, barriers, switches = [], introduction) {
  const hoop = mechanics.includes("hoop");
  const leftX = [98, 102, 94][variant];
  const rightX = [262, 258, 266][variant];
  const pockets = [
    receiver("left", leftX, -130, 1, "safe"),
    receiver("right", rightX, -140, 1, "reward", introduction ? 116 : 104),
    receiver("left-upper", [98, 124, 78][variant], -400, 2, "safe"),
    receiver("right-upper", [262, 236, 282][variant], -415, 2, "reward", 116),
    receiver("rest", 180, -680, 3, "recovery", 144)
  ];
  if (hoop) pockets[1] = {
    ...pockets[1],
    width: 104,
    center: { x: 240, y: -140 },
    orbit: { radius: 48, periodTicks: 720, phaseTicks: variant * 240, direction: 1 }
  };
  const cue = introduction === "hoop" ? "The hoop keeps turning while you aim. Pull, follow its motion, then release." : introduction === "tear" ? "Punch through the loose cloth with a strong pull. The tear stays open if you land below." : introduction === "switch" ? "Hit the button to unzip the matching passage. It stays open for the climb." : introduction === "shutter" ? "The striped shutter opens, warns, then closes. Release when the passage is clear." : mechanics.length ? "Choose your challenge. Read the cloth openings before you release." : "Thread the cloth corridors. Control your angle as well as your pull.";
  const shapedBarriers = barriers.flatMap((value) => {
    if (variant === 1 && value.id === "upper-middle") return [{ ...value, x: 0, width: 110 }];
    if (variant === 1 && value.id === "upper-left") return [{ ...value, x: 250, width: 110 }];
    if (variant === 1 && value.id === "upper-right") return [];
    if (variant === 2 && value.id === "upper-middle") return [{ ...value, x: 108, width: 144 }];
    return [value];
  });
  return {
    id,
    family: mechanics.includes("shutter") ? "gate" : mechanics.includes("tear") ? "cushion" : "fork",
    entryX: { min: 100, max: 260 },
    exitX: { min: 180, max: 180 },
    pockets,
    connections: links2,
    exitPocketId: "rest",
    bumpers: variant === 2 && !introduction ? [{ id: "recovery-cushion", center: { x: 20, y: -604 }, radius: 18, restitution: 0.98 }] : [],
    hazards: [],
    pickups: [{ id: "gift", kind: "preview", center: { x: [262, 236, 282][variant], y: -439 }, radius: 17 }],
    mechanics,
    barriers: shapedBarriers,
    switches,
    ...introduction ? { introduction } : {},
    cue
  };
}
function sensor(id, pocketId2, variant, doorId, introductory) {
  const x = pocketId2 === "left" ? [98, 102, 94][variant] : [262, 258, 266][variant];
  return {
    id,
    center: {
      x: x + (introductory ? 0 : pocketId2 === "left" ? 32 : -32),
      y: pocketId2 === "left" ? -174 : -184
    },
    radius: 20,
    doorIds: [doorId],
    ...introductory ? { pocketId: pocketId2 } : {}
  };
}
function lesson(mechanic, variant, introductory) {
  const id = `${mechanic}-${introductory ? "lesson" : "course"}-${variant}`;
  const phase = variant * 160;
  if (mechanic === "hoop") {
    const walls2 = [
      barrier("lower-left", 0, -267, introductory ? 24 : 52),
      barrier("lower-edge", introductory ? 124 : 118, -267, introductory ? 1 : 6),
      ...upperWalls,
      barrier("lower-far-left", 0, -281, 24)
    ];
    return layout(id, variant, ["hoop"], introductory ? walls2.slice(0, 3) : walls2, [], introductory ? "hoop" : void 0);
  }
  const kind = mechanic === "tear" ? "tearable" : mechanic === "switch" ? "door" : "shutter";
  const walls = introductory ? [
    barrier("right-obstacle", 205, -267, 155, kind, phase),
    barrier("lower-middle", 130, -267, 75),
    ...upperWalls,
    barrier("lower-left", 0, -267, 24)
  ] : [
    barrier("left-obstacle", 0, -267, 170, kind, phase),
    barrier("right-obstacle", 190, -267, 170, kind, phase + 120),
    barrier("lower-middle", 170, -267, 20),
    ...upperWalls
  ];
  const switches = mechanic === "switch" ? [
    ...!introductory ? [sensor("left-button", "left", variant, "left-obstacle", false)] : [],
    sensor("right-button", "right", variant, "right-obstacle", introductory)
  ] : [];
  return layout(id, variant, [mechanic], introductory ? walls.slice(0, 3) : walls, switches, introductory ? mechanic : void 0);
}
var INTERACTIVE_CORRIDORS = [0, 1, 2].map((variant) => layout(`cloth-corridor-${variant}`, variant, [], [
  barrier("lower-middle", 122 + variant * 4, -267, 116 - variant * 8, "thorns"),
  upperWalls[0],
  barrier("lower-left", 0, -267, 42 + variant * 3),
  barrier("lower-right", 318 - variant * 3, -267, 42 + variant * 3),
  ...upperWalls.slice(1)
]));
var INTERACTIVE_LESSONS = INTERACTIVE_MECHANICS.flatMap((mechanic) => [0, 1, 2].map((variant) => lesson(mechanic, variant, true)));
var INTERACTIVE_COURSES = INTERACTIVE_MECHANICS.flatMap((mechanic) => [0, 1, 2].map((variant) => lesson(mechanic, variant, false)));
var INTERACTIVE_COMBINATIONS = INTERACTIVE_MECHANICS.flatMap((first, index) => INTERACTIVE_MECHANICS.slice(index + 1).map((second, offset) => {
  const variant = (index + offset) % 3;
  if (first === "hoop") {
    const kind = second === "tear" ? "tearable" : second === "switch" ? "door" : "shutter";
    return layout(`hoop-${second}-course`, variant, [first, second], [
      barrier("left-obstacle", 52, -267, 70, kind, variant * 160),
      barrier("lower-left", 0, -267, 52),
      ...upperWalls,
      barrier("lower-edge", 122, -267, 2)
    ], second === "switch" ? [sensor("left-button", "left", variant, "left-obstacle", false)] : []);
  }
  const kinds = { tear: "tearable", switch: "door", shutter: "shutter" };
  const switches = [first, second].flatMap((mechanic, side) => mechanic === "switch" ? [sensor(`${side ? "right" : "left"}-button`, side ? "right" : "left", variant, `${side ? "right" : "left"}-obstacle`, false)] : []);
  return layout(`${first}-${second}-course`, variant, [first, second], [
    barrier("left-obstacle", 0, -267, 170, kinds[first], variant * 160),
    barrier("right-obstacle", 190, -267, 170, kinds[second], variant * 160 + 120),
    barrier("lower-middle", 170, -267, 20),
    ...upperWalls
  ], switches);
}));
var INTERACTIVE_SECTION_PATTERNS = [...INTERACTIVE_CORRIDORS, ...INTERACTIVE_LESSONS, ...INTERACTIVE_COURSES, ...INTERACTIVE_COMBINATIONS];
function mirrorInteractiveSection(pattern) {
  const mirrored = mirrorSection(pattern);
  return {
    ...pattern,
    ...mirrored,
    pockets: mirrored.pockets.map((pocket2, index) => ({
      ...pocket2,
      ...pattern.pockets[index].orbit ? { orbit: {
        ...pattern.pockets[index].orbit,
        phaseTicks: (pattern.pockets[index].orbit.periodTicks / 2 - pattern.pockets[index].orbit.phaseTicks + pattern.pockets[index].orbit.periodTicks) % pattern.pockets[index].orbit.periodTicks,
        direction: -(pattern.pockets[index].orbit.direction ?? 1)
      } } : {}
    })),
    barriers: pattern.barriers.map((value) => ({ ...value, x: 360 - value.x - value.width })),
    switches: pattern.switches.map((value) => ({ ...value, center: { x: 360 - value.center.x, y: value.center.y } }))
  };
}
function randomWord3(seed, index) {
  let word = (seed ^ Math.imul(index + 1, 2654435769)) >>> 0;
  word = Math.imul(word ^ word >>> 16, 2246822507);
  word = Math.imul(word ^ word >>> 13, 3266489909);
  return (word ^ word >>> 16) >>> 0;
}
function chooseInteractiveSection(seed, index, entry, _previousFamily, score, introductions) {
  const word = randomWord3(seed, index);
  const stage = Math.min(4, worldStageForScore(score));
  const pending = INTERACTIVE_MECHANICS.findIndex((_, mechanic) => mechanic < stage && introductions[mechanic] < 3);
  let pattern;
  if (pending !== -1) pattern = INTERACTIVE_LESSONS[pending * 3 + introductions[pending]];
  else if (stage === 0 || word % 3 === 0) pattern = INTERACTIVE_CORRIDORS[(word >>> 6) % 3];
  else {
    const combinations = INTERACTIVE_COMBINATIONS.filter((candidate) => candidate.mechanics.every((mechanic) => {
      const index2 = INTERACTIVE_MECHANICS.indexOf(mechanic);
      return index2 < stage && introductions[index2] === 3;
    }));
    const courses = INTERACTIVE_COURSES.filter((candidate) => INTERACTIVE_MECHANICS.indexOf(candidate.mechanics[0]) < stage);
    const candidates = score >= 100 || stage >= 2 && word % 4 === 0 ? combinations : courses;
    pattern = (candidates.length ? candidates : courses)[(word >>> 8) % (candidates.length || courses.length)];
  }
  if (entry.min < pattern.entryX.min || entry.max > pattern.entryX.max) throw new Error(`No interactive section accepts ${entry.min}..${entry.max}`);
  const [minimum, maximum] = obstacleBudget(score);
  const density = pattern.introduction ? pattern.barriers.length : Math.min(pattern.barriers.length, minimum + (word >>> 12 & 1), maximum);
  pattern = { ...pattern, barriers: pattern.barriers.slice(0, density) };
  if (score >= 60 && pattern.id === "cloth-corridor-2") pattern = {
    ...pattern,
    family: "fray",
    mechanics: ["fray"],
    pockets: pattern.pockets.map((pocket2) => pocket2.id === "right-upper" ? { ...pocket2, frayTicks: 480 } : pocket2),
    cue: "Thread the narrow side passage. The upper loose pocket lasts four seconds."
  };
  if (maximum === 0) {
    const heights = { left: -125, right: -145, "left-upper": -255, "right-upper": -280, rest: -410 };
    pattern = {
      ...pattern,
      id: `${pattern.id}-warmup`,
      bumpers: [],
      pockets: pattern.pockets.map((pocket2) => ({
        ...pocket2,
        center: { ...pocket2.center, y: heights[pocket2.id] }
      })),
      pickups: pattern.pickups.map((pickup) => ({ ...pickup, center: { ...pickup.center, y: -304 } }))
    };
  }
  return word & 256 ? mirrorInteractiveSection(pattern) : pattern;
}

// src/game/launch/interactiveWindow.ts
function updateInteractiveWindow(run) {
  const progress = run.sectionProgress;
  let pockets = [...run.room.pockets];
  let bumpers = [...run.room.bumpers];
  let hazards = [...run.room.hazards];
  let pickups = [...run.room.pickups ?? []];
  let barriers = [...run.room.barriers ?? []];
  let switches = [...run.room.switches ?? []];
  if (run.nextPocketIndex === 1) {
    pockets = pockets.map((pocket2) => ({ ...pocket2, ascentRank: 0, sectionId: "opening" }));
  }
  while (run.nextPocketIndex < 3) {
    const rank = run.nextPocketIndex;
    const center = { x: rank === 1 ? 240 : 260, y: run.lastGeneratedY - (rank === 1 ? 100 : 135) };
    pockets.push({
      id: `endless-${rank}`,
      kind: "checkpoint",
      center,
      width: 144,
      ascentRank: rank,
      sectionId: "opening"
    });
    if (rank === 2) pickups.push({
      id: "opening-preview",
      kind: "preview",
      center: { x: center.x + 20, y: center.y - 45 },
      radius: 14
    });
    run.lastGeneratedY = center.y;
    run.lastExitX = { min: center.x, max: center.x };
    run.nextPocketIndex += 1;
  }
  while (run.nextPocketIndex <= run.highestPocket + 5) {
    const index = progress.nextIndex;
    const pattern = chooseInteractiveSection(
      run.seed,
      index,
      run.lastExitX,
      progress.lastFamily,
      run.pocketsCaught,
      progress.introductions
    );
    const id = `section-${index}`;
    const entryPocketId = progress.sections.at(-1)?.exitPocketId ?? "endless-2";
    const localId = (value) => value === "entry" ? entryPocketId : `${id}-${value}`;
    const translated = (point2) => ({ x: point2.x, y: point2.y + run.lastGeneratedY });
    const baseRank = run.nextPocketIndex - 1;
    const ownedPockets = pattern.pockets.map((pocket2) => ({
      ...pocket2,
      id: localId(pocket2.id),
      sectionId: id,
      ascentRank: baseRank + pocket2.ascentRank,
      center: translated(pocket2.center)
    }));
    const ownedBumpers = pattern.bumpers.map((bumper) => ({ ...bumper, id: localId(bumper.id), center: translated(bumper.center) }));
    const ownedHazards = pattern.hazards.map((hazard) => ({ ...hazard, id: localId(hazard.id), center: translated(hazard.center) }));
    const ownedBarriers = pattern.barriers.map((value) => ({ ...value, id: localId(value.id), y: value.y + run.lastGeneratedY }));
    const ownedSwitches = pattern.switches.map((value) => ({
      ...value,
      id: localId(value.id),
      center: translated(value.center),
      doorIds: value.doorIds.map(localId),
      ...value.pocketId ? { pocketId: localId(value.pocketId) } : {}
    }));
    const scheduled = index % 2 === 1 && (run.generationVersion ?? 1) >= 5 ? CREATIVE_TOOLS[Math.floor(index / 2) % CREATIVE_TOOLS.length] : ["preview", "revive", "teleport"][Math.floor(index / 2) % 3];
    const kind = scheduled === "revive" && (run.reviveUsed || run.inventory.revive > 0) ? "preview" : scheduled;
    const ownedPickups = index % 2 === 0 || (run.generationVersion ?? 1) >= 5 ? pattern.pickups.map((pickup) => ({
      ...pickup,
      kind,
      id: localId(pickup.id),
      center: translated(pickup.center)
    })) : [];
    const exit = ownedPockets.find((pocket2) => pocket2.id === localId(pattern.exitPocketId));
    const section2 = {
      id,
      index,
      patternId: pattern.id,
      family: pattern.family,
      startRank: baseRank + 1,
      endRank: exit.ascentRank,
      entryPocketId,
      exitPocketId: exit.id,
      pocketIds: ownedPockets.map((pocket2) => pocket2.id),
      bumperIds: ownedBumpers.map((bumper) => bumper.id),
      hazardIds: ownedHazards.map((hazard) => hazard.id),
      pickupIds: ownedPickups.map((pickup) => pickup.id),
      connections: pattern.connections.map((edge) => ({ from: localId(edge.from), to: localId(edge.to) })),
      cue: pattern.cue,
      worldStage: worldStageForScore(run.pocketsCaught),
      mechanics: pattern.mechanics,
      windZoneIds: [],
      barrierIds: ownedBarriers.map((value) => value.id),
      switchIds: ownedSwitches.map((value) => value.id),
      ...pattern.introduction ? { introduction: pattern.introduction } : {}
    };
    if (pattern.introduction) {
      const introductions = [...progress.introductions];
      introductions[INTERACTIVE_MECHANICS.indexOf(pattern.introduction)] += 1;
      progress.introductions = introductions;
    }
    progress.sections = [...progress.sections, section2];
    progress.nextIndex += 1;
    progress.lastFamily = pattern.family;
    pockets.push(...ownedPockets);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    pickups.push(...ownedPickups);
    barriers.push(...ownedBarriers);
    switches.push(...ownedSwitches);
    run.lastGeneratedY = exit.center.y;
    run.lastExitX = pattern.exitX;
    run.lastPatternId = pattern.id;
    run.nextPocketIndex = exit.ascentRank + 1;
  }
  const reached = progress.sections.filter((section2) => section2.startRank <= run.highestPocket).at(-1);
  const minimumIndex = (reached?.index ?? 0) - 1;
  const sourceId = run.state.stitchedPocket?.pocket.id === run.state.pocketId ? run.state.stitchedPocket.originPocketId : run.state.pocketId;
  const sourceSectionId = pockets.find((pocket2) => pocket2.id === sourceId)?.sectionId;
  progress.sections = progress.sections.filter((section2) => section2.index >= minimumIndex || section2.id === sourceSectionId);
  const retainedSections = new Set(progress.sections.map((section2) => section2.id));
  if (minimumIndex <= 0 || sourceSectionId === "opening") retainedSections.add("opening");
  const retainedPockets = pockets.filter((pocket2) => retainedSections.has(pocket2.sectionId));
  const ids = new Set(retainedPockets.map((pocket2) => pocket2.id));
  const bumperIds = new Set(progress.sections.flatMap((section2) => section2.bumperIds));
  const hazardIds = new Set(progress.sections.flatMap((section2) => section2.hazardIds));
  const pickupIds = new Set(progress.sections.flatMap((section2) => section2.pickupIds));
  const barrierIds = new Set(progress.sections.flatMap((section2) => section2.barrierIds ?? []));
  const switchIds = new Set(progress.sections.flatMap((section2) => section2.switchIds ?? []));
  run.state.brokenBarrierIds = run.state.brokenBarrierIds?.filter((id) => barrierIds.has(id)) ?? [];
  run.state.activatedSwitchIds = run.state.activatedSwitchIds?.filter((id) => switchIds.has(id)) ?? [];
  if (retainedSections.has("opening")) pickupIds.add("opening-preview");
  run.collectedPickupIds = run.collectedPickupIds.filter((id) => pickupIds.has(id));
  run.state.pickupIds = [...run.collectedPickupIds];
  if (run.state.pocketExpiryTicks) run.state.pocketExpiryTicks = Object.fromEntries(
    Object.entries(run.state.pocketExpiryTicks).filter(([id]) => ids.has(id))
  );
  run.room = {
    ...run.room,
    pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => bumperIds.has(bumper.id)),
    hazards: hazards.filter((hazard) => hazardIds.has(hazard.id)),
    pickups: pickups.filter((pickup) => pickupIds.has(pickup.id) && !run.collectedPickupIds.includes(pickup.id)),
    barriers: barriers.filter((value) => barrierIds.has(value.id)),
    switches: switches.filter((value) => switchIds.has(value.id)),
    windZones: []
  };
  const next = progress.sections.flatMap((section2) => section2.connections).find((edge) => edge.from === run.state.pocketId && ids.has(edge.to));
  run.nextPocketId = next?.to ?? (run.state.pocketId === "endless-0" ? "endless-1" : run.state.pocketId === "endless-1" ? "endless-2" : retainedPockets.find((pocket2) => pocket2.ascentRank > run.highestPocket)?.id ?? run.state.pocketId);
}

// src/game/launch/endless.ts
var ENDLESS_WIDTH = 360;
var ENDLESS_HEIGHT = 600;
var ENDLESS_START_Y = 490;
var LOOK_AHEAD = 5;
var KEEP_BEHIND = 2;
var CAMERA_EASING = 0.08;
var RECOVERY_FLOOR_CLEARANCE = 110;
function pocketId(index) {
  return `endless-${index}`;
}
function pocketIndex(id) {
  return Number(id.slice("endless-".length));
}
function opening(index) {
  const x = index === 1 ? 240 : 260;
  return {
    id: `opening-${index}`,
    family: "opening",
    band: "intro",
    entryX: { min: index === 1 ? 80 : 240, max: index === 1 ? 80 : 240 },
    exitX: { min: x, max: x },
    receiver: { center: { x, y: index === 1 ? -100 : -135 }, width: 144 },
    bumpers: [],
    hazards: []
  };
}
function updateLegacyWindow(run) {
  const pockets = [...run.room.pockets];
  const bumpers = [...run.room.bumpers];
  const hazards = [...run.room.hazards];
  const pickups = [...run.room.pickups ?? []];
  while (run.nextPocketIndex <= run.highestPocket + LOOK_AHEAD) {
    const index = run.nextPocketIndex;
    const pattern = index < 3 ? opening(index) : chooseChallenge(run.seed, index, run.lastExitX, run.lastFamily, run.lastPatternId);
    const originY = run.lastGeneratedY;
    const translated = (point2) => ({ x: point2.x, y: point2.y + originY });
    const pocket2 = {
      ...pattern.receiver,
      id: pocketId(index),
      kind: "checkpoint",
      center: translated(pattern.receiver.center)
    };
    const ownedBumpers = pattern.bumpers.map((bumper, number) => ({
      ...bumper,
      id: `endless-bumper-${index}-${number}`,
      center: translated(bumper.center)
    }));
    const ownedHazards = pattern.hazards.map((hazard, number) => ({
      ...hazard,
      id: `endless-thorns-${index}-${number}`,
      center: translated(hazard.center)
    }));
    const scheduled = scheduledPickupKind(index);
    const kind = scheduled === "revive" && (run.reviveUsed || run.inventory.revive > 0) ? "preview" : scheduled;
    const placement = kind ? pickupPlacement(pattern) : void 0;
    const ownedPickups = kind && placement ? [{
      ...placement,
      id: `endless-pickup-${index}`,
      kind,
      center: translated(placement.center)
    }] : [];
    pockets.push(pocket2);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    pickups.push(...ownedPickups);
    run.challenges = [...run.challenges, {
      index,
      pocketId: pocket2.id,
      patternId: pattern.id,
      family: pattern.family,
      band: pattern.band,
      cue: pattern.cue,
      bumperIds: ownedBumpers.map((bumper) => bumper.id),
      hazardIds: ownedHazards.map((hazard) => hazard.id),
      pickupIds: ownedPickups.map((pickup) => pickup.id)
    }];
    run.lastGeneratedY = pocket2.center.y;
    run.lastExitX = pattern.exitX;
    run.lastFamily = pattern.family;
    run.lastPatternId = pattern.id;
    run.nextPocketIndex += 1;
  }
  const minimumIndex = Math.max(0, run.highestPocket - KEEP_BEHIND);
  const oldestVisibleY = run.cameraY + ENDLESS_HEIGHT + 80;
  const retainedPockets = pockets.filter(
    (pocket2) => pocket2.id === run.state.pocketId || pocketIndex(pocket2.id) >= minimumIndex && pocket2.center.y <= oldestVisibleY
  );
  run.challenges = run.challenges.filter((challenge) => challenge.index >= minimumIndex);
  const retainedBumpers = new Set(run.challenges.flatMap((challenge) => challenge.bumperIds));
  const retainedHazards = new Set(run.challenges.flatMap((challenge) => challenge.hazardIds));
  const retainedPickups = new Set(run.challenges.flatMap((challenge) => challenge.pickupIds));
  run.collectedPickupIds = run.collectedPickupIds.filter((id) => Number(id.slice(id.lastIndexOf("-") + 1)) >= minimumIndex);
  run.state.pickupIds = [...run.collectedPickupIds];
  run.room = {
    ...run.room,
    pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => retainedBumpers.has(bumper.id)),
    hazards: hazards.filter((hazard) => retainedHazards.has(hazard.id)),
    pickups: pickups.filter((pickup) => retainedPickups.has(pickup.id) && !run.collectedPickupIds.includes(pickup.id))
  };
  run.nextPocketId = pocketId(run.highestPocket + 1);
}
function updateWindow(run) {
  if ((run.generationVersion ?? 1) >= 4) updateInteractiveWindow(run);
  else if ((run.generationVersion ?? 1) >= 2) updateSectionWindow(run);
  else updateLegacyWindow(run);
}
function createEndlessRun(seed, generationVersion = 6) {
  const stableSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const room = {
    id: "endless-climb",
    name: "Pull & Launch",
    subtitle: "How high can one little button climb?",
    hint: generationVersion >= 2 ? "Pull down and away, then let go. Bounce off the padded sides. Lower pockets can catch a miss." : "Pull down and away, then let go. Keep catching pockets. A fall ends your climb.",
    bounds: { width: ENDLESS_WIDTH, height: ENDLESS_HEIGHT, top: Number.NEGATIVE_INFINITY, bottom: ENDLESS_HEIGHT },
    gravity: 700,
    flightTimeoutTicks: null,
    ...generationVersion >= 2 ? { sideWallRestitution: 0.8 } : {},
    startPocketId: pocketId(0),
    pockets: [{ id: pocketId(0), center: { x: 80, y: ENDLESS_START_Y }, width: 78, kind: "start" }],
    bumpers: [],
    hazards: [],
    pickups: [],
    ...generationVersion >= 3 ? { windZones: [] } : {},
    ...generationVersion >= 4 ? { barriers: [], switches: [] } : {}
  };
  const run = {
    generationVersion,
    ...generationVersion >= 2 ? { sectionProgress: { nextIndex: 0, sections: [], ...generationVersion >= 3 ? { introductions: [0, 0, 0, 0] } : {} } } : {},
    seed: stableSeed,
    room,
    state: createLaunchState(room),
    cameraY: 0,
    highestPocket: 0,
    pocketsCaught: 0,
    height: 0,
    nextPocketId: pocketId(1),
    nextPocketIndex: 1,
    lastGeneratedY: ENDLESS_START_Y,
    lastExitX: { min: 80, max: 80 },
    lastFamily: "opening",
    lastPatternId: "opening-0",
    challenges: [],
    inventory: emptyToolInventory(),
    ...generationVersion >= 6 ? { freeToolQueue: [] } : {},
    reviveUsed: false,
    previewActive: false,
    collectedPickupIds: [],
    lastCatchSnapshot: null
  };
  updateWindow(run);
  run.lastCatchSnapshot = captureEndlessWorld(run);
  return run;
}
function launchEndless(run, pull) {
  const launched = launch(run.room, run.state, { tick: run.state.tick, pocketId: run.state.pocketId, pull });
  if (launched) run.previewActive = false;
  return launched;
}
function arrive(run, id) {
  const pocket2 = effectivePockets(run.room, run.state).find((candidate) => candidate.id === id);
  const stitchedArrival = run.state.stitchedPocket?.pocket.id === id;
  const position2 = pocketPosition(pocket2, run.state.tick, run.state);
  Object.assign(run.state, {
    pocketId: id,
    phase: "held",
    position: position2,
    previousPosition: { ...position2 },
    velocity: { x: 0, y: 0 },
    flightTicks: 0,
    sourcePocketImmune: true,
    failure: void 0,
    checkpoint: { pocketId: id, tick: run.state.tick, patchCollected: run.state.patchCollected }
  });
  run.room = { ...run.room, pockets: run.room.pockets.map((candidate) => candidate.id === id && candidate.motion ? {
    ...candidate,
    motion: void 0,
    center: { ...position2 }
  } : candidate) };
  startPocketLifetime(run.state, pocket2);
  activateLandingSwitches(run.room, run.state, id);
  clearFlightToolEffects(run.state);
  if (!stitchedArrival) {
    run.state.stitchedPocket = void 0;
    run.state.stitchUsedSinceAuthored = void 0;
  }
  if (run.state.frayedFall !== void 0) run.state.frayedFall = false;
  const index = stitchedArrival ? run.highestPocket : (run.generationVersion ?? 1) >= 2 ? pocket2.ascentRank : pocketIndex(id);
  if (index > run.highestPocket) {
    run.pocketsCaught += 1;
    run.highestPocket = index;
  }
  if (!stitchedArrival) updateWindow(run);
  pruneToolPhaseOffsets(run.room, run.state);
}
function updateView(run, cameraFrozen) {
  run.height = Math.max(run.height, Math.round(ENDLESS_START_Y - run.state.position.y));
  const forgiving = run.room.sideWallRestitution !== void 0;
  if (!cameraFrozen && run.state.phase !== "failed") {
    const followLine = run.state.phase === "held" ? 480 : 320;
    let target2 = Math.min(run.cameraY, run.state.position.y - followLine);
    if (forgiving) {
      if (run.state.phase === "held") {
        const held = effectivePockets(run.room, run.state).find((pocket2) => pocket2.id === run.state.pocketId);
        const lowestAnchor = held?.orbit ? held.center.y + held.orbit.radius : run.state.position.y;
        target2 = Math.min(0, lowestAnchor - followLine);
      } else if (run.state.velocity.y > 0) {
        target2 = Math.min(0, Math.max(run.cameraY, run.state.position.y - 380));
      }
    }
    const distance = target2 - run.cameraY;
    run.cameraY = Math.abs(distance) < 0.05 ? target2 : run.cameraY + distance * CAMERA_EASING;
    const heldOrbit = run.state.phase === "held" ? run.room.pockets.find((pocket2) => pocket2.id === run.state.pocketId && pocket2.orbit) : void 0;
    if (heldOrbit?.orbit) {
      run.cameraY = Math.max(
        heldOrbit.center.y + heldOrbit.orbit.radius - 480,
        Math.min(run.cameraY, heldOrbit.center.y - heldOrbit.orbit.radius - 12)
      );
    }
  }
  const bottom = forgiving ? Math.max(...effectivePockets(run.room, run.state).map((pocket2) => pocket2.center.y + (pocket2.orbit?.radius ?? 0))) + RECOVERY_FLOOR_CLEARANCE : run.cameraY + ENDLESS_HEIGHT;
  if (bottom !== run.room.bounds.bottom) {
    run.room = { ...run.room, bounds: { ...run.room.bounds, bottom } };
  }
}
function collect(run, event) {
  if (run.collectedPickupIds.includes(event.id)) return [];
  run.collectedPickupIds.push(event.id);
  const award = event.kind === "revive" && (run.reviveUsed || run.inventory.revive > 0) ? "preview" : event.kind;
  const replacedKind = grantFreeTool(run, award);
  run.room = { ...run.room, pickups: run.room.pickups?.filter((pickup) => pickup.id !== event.id) };
  return [{
    ...event,
    kind: award,
    ...award !== event.kind ? { convertedFrom: "revive" } : {},
    ...replacedKind ? { replacedKind } : {}
  }];
}
function stepEndless(run, cameraFrozen = false) {
  if (run.state.phase === "failed" || run.state.phase === "complete") return [];
  const events = stepLaunch(run.room, run.state).flatMap((event) => event.type === "pickup" ? collect(run, event) : [event]);
  if (events.length) run.state.event = events[events.length - 1];
  const caught = events.some((event) => event.type === "catch");
  if (caught) arrive(run, run.state.pocketId);
  else if (events.some((event) => event.type === "fail" || event.type === "complete")) {
    clearFlightToolEffects(run.state);
    if (run.state.stitchedPocket?.pocket.id !== run.state.pocketId) run.state.stitchedPocket = void 0;
  }
  updateView(run, cameraFrozen);
  if (caught) run.lastCatchSnapshot = captureEndlessWorld(run);
  return events;
}
function spend(run, kind, paid) {
  if (paid) return true;
  return spendFreeTool(run, kind);
}
function activatePreview(run, paid = false) {
  if (run.state.phase !== "held" || run.previewActive || !spend(run, "preview", paid)) return false;
  run.previewActive = true;
  run.state.event = { type: "tool", tick: run.state.tick, id: run.state.pocketId, kind: "preview" };
  return true;
}
function eligibleTeleportPockets(run) {
  if (run.state.phase === "failed" || run.state.phase === "complete") return [];
  const bottom = Math.min(run.cameraY + ENDLESS_HEIGHT, run.room.bounds.bottom ?? Number.POSITIVE_INFINITY);
  return effectivePockets(run.room, run.state).filter((pocket2) => {
    if (run.state.stitchedPocket?.spent && pocket2.id === run.state.stitchedPocket.pocket.id) return false;
    const position2 = pocketPosition(pocket2, run.state.tick, run.state);
    return !isPocketExpired(run.state, pocket2) && pocket2.id !== run.state.pocketId && position2.y - BUTTON_RADIUS >= run.cameraY && position2.y + BUTTON_RADIUS <= bottom && position2.x - pocket2.width / 2 >= 0 && position2.x + pocket2.width / 2 <= run.room.bounds.width;
  });
}
function teleportEndless(run, pocketId2, paid = false) {
  if (!eligibleTeleportPockets(run).some((pocket2) => pocket2.id === pocketId2) || !spend(run, "teleport", paid)) return false;
  arrive(run, pocketId2);
  run.state.event = { type: "tool", tick: run.state.tick, id: pocketId2, kind: "teleport" };
  updateView(run, false);
  run.lastCatchSnapshot = captureEndlessWorld(run);
  return true;
}
function reviveEndless(run, paid = false) {
  if (run.state.phase !== "failed" || run.reviveUsed || !run.lastCatchSnapshot || !spend(run, "revive", paid)) return false;
  const checkpoint = run.lastCatchSnapshot;
  restoreEndlessWorld(run, checkpoint);
  run.reviveUsed = true;
  run.previewActive = false;
  run.inventory.preview += run.inventory.revive;
  run.inventory.revive = 0;
  if (run.freeToolQueue) run.freeToolQueue = run.freeToolQueue.map((kind) => kind === "revive" ? "preview" : kind);
  run.state.pickupIds = [...run.collectedPickupIds];
  run.room = { ...run.room, pickups: run.room.pickups?.filter((pickup) => !run.collectedPickupIds.includes(pickup.id)) };
  run.state.event = { type: "tool", tick: run.state.tick, id: run.state.pocketId, kind: "revive" };
  return true;
}

// src/commerce/toolUse.ts
function record2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value, allowed) {
  return Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key));
}
function position(value) {
  return record2(value) && keys(value, ["x", "y"]) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
}
function target(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}
function parseToolUse(value) {
  if (!record2(value) || !isToolKind(value.tool)) return null;
  switch (value.tool) {
    case "preview":
    case "revive":
    case "sail":
    case "needle":
      return keys(value, ["tool"]) ? { tool: value.tool } : null;
    case "teleport":
      return keys(value, ["tool", "pocketId"]) && target(value.pocketId) ? { tool: value.tool, pocketId: value.pocketId } : null;
    case "pin":
    case "velcro":
      return keys(value, ["tool", "targetId"]) && target(value.targetId) ? { tool: value.tool, targetId: value.targetId } : null;
    case "bounce":
      return keys(value, ["tool", "position", "angle"]) && position(value.position) && Number.isInteger(value.angle) && value.angle >= 0 && value.angle < 180 ? { tool: value.tool, position: { x: value.position.x, y: value.position.y }, angle: value.angle } : null;
    case "stitch":
      return keys(value, ["tool", "position"]) && position(value.position) ? { tool: value.tool, position: { x: value.position.x, y: value.position.y } } : null;
  }
}
function canonicalToolUse(use) {
  const parsed = parseToolUse(use);
  if (!parsed) throw new Error("Invalid tool use.");
  return JSON.stringify(parsed);
}

// src/game/launch/tools.ts
function visible(run, position2, halfX = 0, halfY = 0) {
  return position2.x - halfX >= 0 && position2.x + halfX <= run.room.bounds.width && position2.y - halfY >= run.cameraY && position2.y + halfY <= Math.min(run.cameraY + ENDLESS_HEIGHT, run.room.bounds.bottom ?? Infinity);
}
function eligibleVelcroTargets(run) {
  if (run.state.phase !== "held") return [];
  return effectivePockets(run.room, run.state).filter((pocket2) => pocket2.id !== run.state.pocketId && !isPocketExpired(run.state, pocket2) && !(run.state.stitchedPocket?.spent && run.state.stitchedPocket.pocket.id === pocket2.id) && visible(run, pocketPosition(pocket2, run.state.tick, run.state), pocket2.width / 2, 14));
}
function eligiblePinTargets(run) {
  if (run.state.phase !== "held") return [];
  return [
    ...eligibleVelcroTargets(run).filter((pocket2) => pocket2.motion || pocket2.orbit).map((pocket2) => ({ id: pocket2.id, position: pocketPosition(pocket2, run.state.tick, run.state), label: "Moving pocket" })),
    ...run.room.hazards.filter((hazard) => hazard.motion && visible(run, hazardPosition(hazard, run.state.tick, run.state), hazard.radius, hazard.radius)).map((hazard) => ({ id: hazard.id, position: hazardPosition(hazard, run.state.tick, run.state), label: hazard.visual === "scissors" ? "Moving scissors" : "Moving thorns" })),
    ...run.room.barriers?.filter((barrier2) => barrier2.kind === "shutter" && visible(run, { x: barrier2.x + barrier2.width / 2, y: barrier2.y + barrier2.height / 2 }, barrier2.width / 2, barrier2.height / 2)).map((barrier2) => ({ id: barrier2.id, position: { x: barrier2.x + barrier2.width / 2, y: barrier2.y + barrier2.height / 2 }, label: "Shutter" })) ?? []
  ];
}
function pointSegmentDistance(point2, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point2.x - a.x) * dx + (point2.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point2.x - a.x - t * dx, point2.y - a.y - t * dy);
}
function segmentRectangleDistance(a, b, rect) {
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  const pointDistance = (p) => Math.hypot(Math.max(rect.x - p.x, 0, p.x - right), Math.max(rect.y - p.y, 0, p.y - bottom));
  let enter = 0, leave = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, rect.x, right], [a.y, b.y - a.y, rect.y, bottom]]) {
    if (delta === 0) {
      if (start < min || start > max) {
        enter = 2;
        break;
      }
    } else {
      const t1 = (min - start) / delta, t2 = (max - start) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
    }
  }
  if (enter <= leave) return 0;
  return Math.min(pointDistance(a), pointDistance(b), ...[
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: rect.x, y: bottom },
    { x: right, y: bottom }
  ].map((point2) => pointSegmentDistance(point2, a, b)));
}
function placementClear(run, use) {
  const stitch = use.tool === "stitch";
  const angle = (use.tool === "bounce" ? use.angle : 0) * Math.PI / 180;
  const half = stitch ? 0 : (BOUNCE_PATCH_LENGTH - BOUNCE_PATCH_THICKNESS) / 2;
  const physicalRadius = stitch ? STITCH_POCKET_WIDTH / 2 : BOUNCE_PATCH_THICKNESS / 2;
  const clearance = stitch ? MAX_PULL + BUTTON_RADIUS : physicalRadius + BUTTON_RADIUS;
  const a = { x: use.position.x - Math.cos(angle) * half, y: use.position.y - Math.sin(angle) * half };
  const b = { x: use.position.x + Math.cos(angle) * half, y: use.position.y + Math.sin(angle) * half };
  if (!visible(
    run,
    use.position,
    Math.abs(Math.cos(angle) * half) + physicalRadius,
    stitch ? 35 : Math.abs(Math.sin(angle) * half) + physicalRadius
  )) return false;
  for (const pocket2 of effectivePockets(run.room, run.state)) {
    const position2 = pocketPosition(pocket2, run.state.tick, run.state);
    if (pocket2.id === run.state.pocketId || use.tool === "bounce" && pocket2.id === run.state.stitchedPocket?.pocket.id) {
      const center = pocket2.orbit ? pocket2.center : position2;
      if (pointSegmentDistance(center, a, b) <= MAX_PULL + BUTTON_RADIUS + physicalRadius + (pocket2.orbit?.radius ?? 0)) return false;
    }
    if (stitch && pocket2.orbit && pointSegmentDistance(pocket2.center, a, b) <= pocket2.orbit.radius + pocket2.width / 2 + physicalRadius + BUTTON_RADIUS) return false;
    if (stitch && pocket2.motion && segmentRectangleDistance(a, b, {
      x: pocket2.center.x - pocket2.motion.amplitude - pocket2.width / 2,
      y: pocket2.center.y - 4,
      width: pocket2.width + pocket2.motion.amplitude * 2,
      height: 39
    }) <= physicalRadius + BUTTON_RADIUS) return false;
    if (segmentRectangleDistance(a, b, { x: position2.x - pocket2.width / 2, y: position2.y - 4, width: pocket2.width, height: 39 }) <= physicalRadius + BUTTON_RADIUS) return false;
  }
  for (const obstacle of run.room.bumpers) if (pointSegmentDistance(obstacle.center, a, b) <= obstacle.radius + clearance) return false;
  for (const obstacle of run.room.hazards) {
    if (stitch && obstacle.motion) {
      const amplitude = obstacle.motion.amplitude;
      const vertical = obstacle.motion.axis === "y";
      if (segmentRectangleDistance(a, b, {
        x: obstacle.center.x - (vertical ? 0 : amplitude),
        y: obstacle.center.y - (vertical ? amplitude : 0),
        width: vertical ? 0 : amplitude * 2,
        height: vertical ? amplitude * 2 : 0
      }) <= obstacle.radius + clearance) return false;
    } else if (pointSegmentDistance(hazardPosition(obstacle, run.state.tick, run.state), a, b) <= obstacle.radius + clearance) return false;
  }
  for (const barrier2 of run.room.barriers ?? []) {
    if (barrier2.kind === "tearable" && run.state.brokenBarrierIds?.includes(barrier2.id)) continue;
    if (barrier2.kind === "door" && run.room.switches?.some((sensor2) => sensor2.doorIds.includes(barrier2.id) && run.state.activatedSwitchIds?.includes(sensor2.id))) continue;
    if (segmentRectangleDistance(a, b, barrier2) <= clearance) return false;
  }
  const bounce = run.state.toolEffects?.bounce;
  if (stitch && bounce && !bounce.spent) {
    const radians = bounce.angle * Math.PI / 180, patchHalf = (BOUNCE_PATCH_LENGTH - BOUNCE_PATCH_THICKNESS) / 2;
    if (pointSegmentDistance(
      use.position,
      { x: bounce.position.x - Math.cos(radians) * patchHalf, y: bounce.position.y - Math.sin(radians) * patchHalf },
      { x: bounce.position.x + Math.cos(radians) * patchHalf, y: bounce.position.y + Math.sin(radians) * patchHalf }
    ) <= clearance + BOUNCE_PATCH_THICKNESS / 2) return false;
  }
  return true;
}
function validateToolUse(run, candidate) {
  const use = parseToolUse(candidate);
  if (!use) return false;
  if (use.tool === "revive") return run.state.phase === "failed" && !run.reviveUsed && !!run.lastCatchSnapshot;
  if (use.tool === "teleport") return eligibleTeleportPockets(run).some((pocket2) => pocket2.id === use.pocketId);
  if (run.state.phase !== "held") return false;
  const source = effectivePockets(run.room, run.state).find((pocket2) => pocket2.id === run.state.pocketId);
  if (!source || isPocketExpired(run.state, source)) return false;
  if (use.tool === "preview") return !run.previewActive;
  if ((run.generationVersion ?? 1) < 5) return false;
  const effects = run.state.toolEffects;
  switch (use.tool) {
    case "bounce":
      return !effects?.bounce && placementClear(run, use);
    case "stitch":
      return !run.state.stitchedPocket && !run.state.stitchUsedSinceAuthored && placementClear(run, use);
    case "pin":
      return !effects?.pin && eligiblePinTargets(run).some((target2) => target2.id === use.targetId);
    case "velcro":
      return !effects?.velcro && eligibleVelcroTargets(run).some((target2) => target2.id === use.targetId);
    case "sail":
      return !effects?.sail;
    case "needle":
      return !effects?.needle;
  }
}
function applyEndlessTool(run, use, paid = false) {
  if (!validateToolUse(run, use)) return false;
  if (use.tool === "preview") return activatePreview(run, paid);
  if (use.tool === "teleport") return teleportEndless(run, use.pocketId, paid);
  if (use.tool === "revive") return reviveEndless(run, paid);
  if (!paid && !spendFreeTool(run, use.tool)) return false;
  run.state.toolEffects ??= {};
  switch (use.tool) {
    case "bounce":
      run.state.toolEffects.bounce = { position: { ...use.position }, angle: use.angle, spent: false };
      break;
    case "pin":
      run.state.toolEffects.pin = { targetId: use.targetId, startedTick: run.state.tick };
      break;
    case "velcro":
      run.state.toolEffects.velcro = { targetId: use.targetId };
      break;
    case "sail":
      run.state.toolEffects.sail = true;
      break;
    case "needle":
      run.state.toolEffects.needle = {};
      break;
    case "stitch":
      run.state.stitchedPocket = { pocket: {
        id: `tool-stitch-${run.state.tick}-${run.state.launches}`,
        center: { ...use.position },
        width: STITCH_POCKET_WIDTH,
        kind: "checkpoint"
      }, spent: false, originPocketId: run.state.pocketId };
      run.state.stitchUsedSinceAuthored = true;
      break;
  }
  run.state.event = {
    type: "tool",
    tick: run.state.tick,
    id: "targetId" in use ? use.targetId : use.tool === "stitch" ? run.state.stitchedPocket.pocket.id : run.state.pocketId,
    kind: use.tool
  };
  return true;
}

// src/leaderboard/contracts.ts
var WEEK_MS = 7 * 864e5;
var MAX_BATCH_TICKS = 240;
var MAX_BATCH_COMMANDS = 64;

// src/leaderboard/replay.ts
function createRankedSimulation(seed) {
  return createEndlessRun(seed, 6);
}
function commandToolUse(command) {
  const { type: _type, at: _at, operationId: _operationId, ...use } = command;
  return parseToolUse(use);
}
function validateBatch(batch, elapsed) {
  if (!batch || !Number.isSafeInteger(batch.sequence) || batch.sequence < 0 || batch.from !== elapsed || !Number.isSafeInteger(batch.to) || batch.to < elapsed || batch.to - elapsed > MAX_BATCH_TICKS || !Array.isArray(batch.commands) || batch.commands.length > MAX_BATCH_COMMANDS) throw new Error("Invalid replay batch.");
  if (batch.to === elapsed && !batch.commands.length) throw new Error("Empty batch.");
  if (batch.commands.filter((command) => command?.type === "tool" && command.operationId).length > 8) throw new Error("Too many paid actions.");
  let previous = elapsed;
  for (const command of batch.commands) {
    if (!command || !Number.isSafeInteger(command.at) || command.at < previous || command.at > batch.to) throw new Error("Invalid command order.");
    previous = command.at;
    if (!["aim", "cancel", "launch", "tool"].includes(command.type)) throw new Error("Unknown replay action.");
    if (command.type === "launch" && (!Number.isFinite(command.x) || !Number.isFinite(command.y) || Math.hypot(command.x, command.y) > 100.02)) throw new Error("Invalid launch.");
    if (command.type === "tool" && (!commandToolUse(command) || command.operationId !== void 0 && (typeof command.operationId !== "string" || command.operationId.length === 0 || command.operationId.length > 160))) throw new Error("Invalid tool.");
  }
}
function toolContext(run, command) {
  const use = commandToolUse(command);
  if (!use) throw new Error("Invalid tool.");
  return isCreativeTool(use.tool) ? `${run.state.tick}:${run.state.pocketId}:${canonicalToolUse(use)}` : `${run.state.tick}:${run.state.pocketId}:${use.tool}:${use.tool === "teleport" ? use.pocketId : ""}`;
}
async function replayBatch(run, cursor, batch, authorize = async () => {
  throw new Error("Paid receipt required.");
}) {
  validateBatch(batch, cursor.elapsed);
  for (const command of batch.commands) {
    while (cursor.elapsed < command.at) {
      stepEndless(run, cursor.aiming);
      cursor.elapsed++;
    }
    if (command.type === "aim") {
      if (run.state.phase !== "held" || cursor.aiming) throw new Error("Invalid aim.");
      cursor.aiming = true;
    } else if (command.type === "cancel") cursor.aiming = false;
    else if (command.type === "launch") {
      const legal = clampEndlessPull({ x: command.x, y: command.y }, run.state.position, run.cameraY, run.room.bounds);
      if (Math.abs(legal.x - command.x) > 0.02 || Math.abs(legal.y - command.y) > 0.02) throw new Error("Pull outside the playfield.");
      if (!cursor.aiming || !launchEndless(run, { x: command.x, y: command.y })) throw new Error("Invalid launch.");
      cursor.aiming = false;
    } else {
      if (command.operationId) await authorize(command, toolContext(run, command));
      const paid = !!command.operationId;
      const applied = applyEndlessTool(run, commandToolUse(command), paid);
      if (!applied) throw new Error("Invalid tool state.");
      cursor.aiming = false;
    }
  }
  while (cursor.elapsed < batch.to) {
    stepEndless(run, cursor.aiming);
    cursor.elapsed++;
  }
}
export {
  createRankedSimulation,
  deserializeEndlessRun,
  replayBatch,
  serializeEndlessRun,
  validateBatch
};
