import type { Position } from '../types';

/**
 * VOR navigation math for training simulation.
 * Coordinate system: +Y = north, +X = east (magnetic). Distances in NM.
 */

/** Maximum lead angle (°) selectable in the intercept panel. */
export const INTERCEPT_LEAD_ANGLE_MAX_DEG = 90;

/**
 * Max angular error (°) between your displayed R-### and the target radial to count as established
 * (intercept lines hide).
 */
export const INTERCEPT_ESTABLISHED_MAX_ERR_DEG = 2.5;

/** Course-error ° that pegs the CDI (training VOR). */
export const VOR_CDI_FULL_SCALE_DEG = 10;

/** Drift off the target radial (°) before violet intercept lines reappear (matches CDI full-scale). */
export const INTERCEPT_OVERLAY_REAPPEAR_ERR_DEG = VOR_CDI_FULL_SCALE_DEG;

/** Lateral deviation-dot spacing on the CDI face (° between marks from centerline). */
export const VOR_CDI_DOT_STEP_DEG = 2;

/** Dots from centerline to full-scale each side (10° FSD ÷ 2° → five marks at 2°, 4°, …, 10°). */
export const VOR_CDI_DOTS_PER_SIDE = VOR_CDI_FULL_SCALE_DEG / VOR_CDI_DOT_STEP_DEG;

/** Normalize any heading/course to [0, 360). */
export function normalizeHeading(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

/** Three-digit magnetic heading for UI; normalized 000° is shown as 360 (common briefing style). */
export function formatMagneticThreeDigit360(deg: number): string {
  const n = Math.round(normalizeHeading(deg));
  const d = n === 0 ? 360 : n;
  return d.toString().padStart(3, '0');
}

/** Magnetic reciprocal (opposite) direction. */
export function reciprocalCourse(deg: number): number {
  return normalizeHeading(deg + 180);
}

/**
 * Shortest signed angle from `fromDeg` to `toDeg`, range (-180, 180].
 * Positive = turn right (clockwise) to reach `toDeg`.
 */
export function shortestSignedAngleDeg(fromDeg: number, toDeg: number): number {
  let d = normalizeHeading(toDeg) - normalizeHeading(fromDeg);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * True when the aircraft lies on the infinite line through the station along `targetRadialDeg`
 * (within `maxErrDeg` of either that radial or its reciprocal).
 */
export function isOnInfiniteRadialLine(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  maxErrDeg = INTERCEPT_ESTABLISHED_MAX_ERR_DEG
): boolean {
  const t = normalizeHeading(targetRadialDeg);
  const r = normalizeHeading(aircraftRadialDeg);
  const d1 = Math.abs(shortestSignedAngleDeg(t, r));
  const d2 = Math.abs(shortestSignedAngleDeg(reciprocalCourse(t), r));
  return Math.min(d1, d2) <= maxErrDeg;
}

/**
 * Angular separation (°) between your displayed R-### and the named target radial (e.g. inbound
 * R-220 → on R-220, not the reciprocal).
 */
export function interceptRadialSeparationDeg(
  aircraftRadialDeg: number,
  targetRadialDeg: number
): number {
  return Math.abs(
    shortestSignedAngleDeg(
      normalizeHeading(targetRadialDeg),
      normalizeHeading(aircraftRadialDeg)
    )
  );
}

/**
 * True when your displayed R-### matches the named target radial (inbound or outbound).
 * Inbound vs outbound only changes the intercept heading to fly, not which R-### counts as on course.
 */
export function isEstablishedOnInterceptRadial(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  _mode: InterceptMode,
  maxErrDeg = INTERCEPT_ESTABLISHED_MAX_ERR_DEG
): boolean {
  return interceptRadialSeparationDeg(aircraftRadialDeg, targetRadialDeg) <= maxErrDeg;
}

/**
 * Signed separation (°) from the target radial; 0° when your R-### matches the target.
 */
export function interceptCourseErrorDeg(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  _mode: InterceptMode
): number {
  return shortestSignedAngleDeg(
    normalizeHeading(targetRadialDeg),
    normalizeHeading(aircraftRadialDeg)
  );
}

/**
 * True when the intercept is complete — map/panel violet overlays should hide.
 */
export function isInterceptEstablished(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  mode: InterceptMode,
  maxErrDeg = INTERCEPT_ESTABLISHED_MAX_ERR_DEG
): boolean {
  return isEstablishedOnInterceptRadial(
    aircraftRadialDeg,
    targetRadialDeg,
    mode,
    maxErrDeg
  );
}

/**
 * True when on the reciprocal end of the target radial (opposite leg of the same course line).
 */
export function isOnOppositeInterceptLeg(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  maxErrDeg = INTERCEPT_ESTABLISHED_MAX_ERR_DEG
): boolean {
  if (interceptRadialSeparationDeg(aircraftRadialDeg, targetRadialDeg) <= maxErrDeg) {
    return false;
  }
  return (
    interceptRadialSeparationDeg(
      aircraftRadialDeg,
      reciprocalCourse(targetRadialDeg)
    ) <= maxErrDeg
  );
}

/**
 * Wrong side for intercepting the named radial (OBS = target): the TO hemisphere (blue on the map).
 * The FROM side (brown) carries the published R-### you are joining.
 */
export function isOnWrongInterceptHemisphere(
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  _mode: InterceptMode
): boolean {
  return (
    vorToFromGeometry(
      normalizeHeading(aircraftRadialDeg),
      normalizeHeading(targetRadialDeg)
    ) === 'TO'
  );
}

/** Mutable latch for intercept overlay hysteresis (hide at ≤2.5°, re-show after &gt;10° off). */
export type InterceptOverlayLatch = { suppressed: boolean };

/**
 * Whether violet intercept map overlays should draw. Hides within {@link INTERCEPT_ESTABLISHED_MAX_ERR_DEG}
 * of the target R-###; after capture, stays hidden until separation exceeds
 * {@link INTERCEPT_OVERLAY_REAPPEAR_ERR_DEG} (10°). Also hides on the opposite leg or wrong TO/FROM side.
 */
export function shouldShowInterceptMapOverlays(
  latch: InterceptOverlayLatch,
  aircraftRadialDeg: number,
  targetRadialDeg: number,
  mode: InterceptMode
): boolean {
  if (
    isOnOppositeInterceptLeg(aircraftRadialDeg, targetRadialDeg) ||
    isOnWrongInterceptHemisphere(aircraftRadialDeg, targetRadialDeg, mode)
  ) {
    latch.suppressed = false;
    return false;
  }

  const sep = interceptRadialSeparationDeg(aircraftRadialDeg, targetRadialDeg);
  if (sep <= INTERCEPT_ESTABLISHED_MAX_ERR_DEG) latch.suppressed = true;
  else if (sep > INTERCEPT_OVERLAY_REAPPEAR_ERR_DEG) latch.suppressed = false;
  if (sep > INTERCEPT_OVERLAY_REAPPEAR_ERR_DEG) return true;
  if (latch.suppressed) return false;
  return sep > INTERCEPT_ESTABLISHED_MAX_ERR_DEG;
}

/**
 * Bearing FROM station TO aircraft (the radial you are on).
 * atan2(east, north) gives compass bearing from north clockwise.
 */
export function radialFromStation(
  station: { x: number; y: number },
  aircraft: { x: number; y: number }
): number {
  const dx = aircraft.x - station.x;
  const dy = aircraft.y - station.y;
  if (dx === 0 && dy === 0) return 0;
  const rad = Math.atan2(dx, dy);
  const deg = (rad * 180) / Math.PI;
  return normalizeHeading(deg);
}

/** Bearing FROM aircraft TO station (homeward). */
export function bearingToStation(radial: number): number {
  return reciprocalCourse(radial);
}

/**
 * TO/FROM using hemisphere relative to the selected OBS course.
 * Outbound from station along printed OBS lies on heading OBS.
 * Compare station→aircraft vector with OBS outbound: same semicircle ⇒ FROM.
 *
 * dot > 0  ⇒ aircraft lies on outbound side of station along OBS ⇒ FROM
 * dot < 0  ⇒ inbound side ⇒ TO
 * |dot| small ⇒ ambiguous (flag instability near abeam / cone).
 */
export function vorToFrom(
  radialDeg: number,
  obsDeg: number,
  ambiguityCosThreshold = 0.05
): 'TO' | 'FROM' | 'AMBIGUOUS' {
  const r = (normalizeHeading(radialDeg) * Math.PI) / 180;
  const o = (normalizeHeading(obsDeg) * Math.PI) / 180;
  const dot = Math.cos(r - o);
  if (Math.abs(dot) < ambiguityCosThreshold) return 'AMBIGUOUS';
  return dot > 0 ? 'FROM' : 'TO';
}

/** Treat |cos(r−o)| as zero — perpendicular to course; CDI uses TO branch (matches open hemisphere). */
const VOR_HEMISPHERE_DOT_EPS = 1e-9;

/**
 * TO/FROM hemisphere from position only — **no** ambiguity band. Used for CDI course error so the
 * needle always reflects actual geometry; flags may still use {@link vorToFrom} with thresholds or
 * cone instability. Perpendicular to course (`cos(r−o) ≈ 0`) ⇒ **TO** (ties closed `dot ≤ 0` side).
 */
export function vorToFromGeometry(radialDeg: number, obsDeg: number): 'TO' | 'FROM' {
  const r = (normalizeHeading(radialDeg) * Math.PI) / 180;
  const o = (normalizeHeading(obsDeg) * Math.PI) / 180;
  const dot = Math.cos(r - o);
  if (Math.abs(dot) < VOR_HEMISPHERE_DOT_EPS) return 'TO';
  return dot > 0 ? 'FROM' : 'TO';
}

/**
 * Max angular gap (°) from the exact TO/FROM split line (radials OBS+90° / OBS−90°, i.e. perpendicular
 * to the selected course through the station) before flags stay valid. Cosine thresholds widen to
 * several degrees; this stays sub-degree so OFF does not appear “a couple of radials early.”
 */
export const VOR_FLAG_BOUNDARY_MAX_DEG = 0.22;

/** True when the aircraft radial lies on that split line within {@link VOR_FLAG_BOUNDARY_MAX_DEG}. */
export function vorOnToFromHemisphereBoundary(radialDeg: number, obsDeg: number): boolean {
  const r = normalizeHeading(radialDeg);
  const perp = normalizeHeading(obsDeg + 90);
  const d = Math.min(
    Math.abs(shortestSignedAngleDeg(r, perp)),
    Math.abs(shortestSignedAngleDeg(r, reciprocalCourse(perp)))
  );
  return d <= VOR_FLAG_BOUNDARY_MAX_DEG;
}

/**
 * Radial value (bearing from station) that centers the CDI for current TO/FROM sense.
 * FROM: on-course when radial === OBS (tracking outbound along OBS).
 * TO: on-course when radial === reciprocal(OBS) (inbound on same course line).
 */
export function referenceRadialForCdi(obsDeg: number, toFrom: 'TO' | 'FROM'): number {
  const obs = normalizeHeading(obsDeg);
  if (toFrom === 'FROM') return obs;
  return reciprocalCourse(obs);
}

/**
 * Signed angular error off the selected course line (degrees).
 * FROM: shortest arc ref → aircraft radial. TO: shortest arc aircraft radial → ref (same CDI “fly
 * toward the needle” sense as FROM). Positive course error maps to left needle via
 * {@link vorCdiNeedleFromCourseError}.
 */
export function vorCourseErrorDeg(
  radialDeg: number,
  obsDeg: number,
  toFrom: 'TO' | 'FROM'
): number {
  const ref = referenceRadialForCdi(obsDeg, toFrom);
  const r = normalizeHeading(radialDeg);
  return toFrom === 'TO' ? shortestSignedAngleDeg(r, ref) : shortestSignedAngleDeg(ref, r);
}

/**
 * Raw linear mapping from signed course error (°) to needle fraction — math sense only.
 * For cockpit display use {@link vorCdiNeedleFromCourseError}.
 */
export function cdiNeedleDeflection(
  courseErrorDeg: number,
  fullScaleDeg = VOR_CDI_FULL_SCALE_DEG
): number {
  const raw = courseErrorDeg / fullScaleDeg;
  if (raw > 1) return 1;
  if (raw < -1) return -1;
  return raw;
}

/**
 * VOR CDI needle position (−1 left … +1 right): **fly toward the needle** (standard cockpit sense).
 * Negates {@link cdiNeedleDeflection} so when you are left of course the needle deflects **right**.
 */
export function vorCdiNeedleFromCourseError(
  courseErrorDeg: number,
  fullScaleDeg = VOR_CDI_FULL_SCALE_DEG
): number {
  return -cdiNeedleDeflection(courseErrorDeg, fullScaleDeg);
}

/** Slant-range distance in NM (flat-earth training approximation). */
export function distanceNm(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function stationPassage(distanceNmVal: number, thresholdNm = 0.35): boolean {
  return distanceNmVal < thresholdNm;
}

/** VOR flag — NAV invalid beyond typical line-of-sight training limit (simple model). */
/** Min/max distance (NM) for the DME distance control — matches typical VOR nav envelope. */
export const DME_EDIT_MIN_NM = 0.05;
export const DME_EDIT_MAX_NM = 120;

/** Plan-map half-span from station (+X east, +Y north) — keeps shaded area aligned with MapCanvas. */
export const MAP_PLAN_VIEW_HALF_NM = 22;
/** Drag/DME inset (NM): stay inside plotted square corners at ±{@link MAP_PLAN_VIEW_HALF_NM}. */
export const MAP_PLAN_DME_MARGIN_NM = 0.4;
/** World NM per CSS pixel — must match MapCanvas drawing scale. */
export const MAP_VIEW_NM_TO_PX = 22;

/** Max DME (NM) along `radialDeg` staying inside ±halfEast / ±halfNorth NM of the station. */
export function maxDistanceNmAlongRadialInExtents(
  radialDeg: number,
  halfEastNm: number,
  halfNorthNm: number
): number {
  const r = (normalizeHeading(radialDeg) * Math.PI) / 180;
  const as = Math.abs(Math.sin(r));
  const ac = Math.abs(Math.cos(r));
  const eps = 1e-15;
  return Math.min(
    halfEastNm / Math.max(as, eps),
    halfNorthNm / Math.max(ac, eps)
  );
}

/** Legacy symmetric bounds (square chart); see {@link maxDistanceNmAlongRadialInExtents} for rectangular viewports. */
export function maxDistanceNmAlongRadialInPlanView(
  radialDeg: number,
  halfExtentNm = MAP_PLAN_VIEW_HALF_NM - MAP_PLAN_DME_MARGIN_NM
): number {
  return maxDistanceNmAlongRadialInExtents(radialDeg, halfExtentNm, halfExtentNm);
}

/** Clamp aircraft NM position to an east/north-aligned box centred on station. */
export function clampAircraftPositionToStationExtents(
  station: Position,
  p: Position,
  halfEastNm: number,
  halfNorthNm: number
): Position {
  const rx = p.x - station.x;
  const ry = p.y - station.y;
  const cxx = Math.max(-halfEastNm, Math.min(halfEastNm, rx));
  const cyy = Math.max(-halfNorthNm, Math.min(halfNorthNm, ry));
  if (cxx === rx && cyy === ry) return p;
  return { x: station.x + cxx, y: station.y + cyy };
}

/**
 * Clamp slant range along the current radial so the point stays inside the plan-map box.
 * Used for TO/FROM training aircraft (line-through-station drags).
 */
export function clampPositionAlongRadialInExtents(
  station: Position,
  p: Position,
  halfEastNm: number,
  halfNorthNm: number,
  minNm: number = DME_EDIT_MIN_NM
): Position {
  const dx = p.x - station.x;
  const dy = p.y - station.y;
  const r = Math.hypot(dx, dy);
  if (r < 1e-12) {
    if (minNm <= 0) return { x: station.x, y: station.y };
    return { x: station.x, y: station.y + minNm };
  }
  const radialDeg = radialFromStation(station, p);
  const maxR = maxDistanceNmAlongRadialInExtents(radialDeg, halfEastNm, halfNorthNm);
  const rClamped = Math.max(minNm, Math.min(maxR, r));
  if (Math.abs(rClamped - r) < 1e-9) return p;
  const scale = rClamped / r;
  return { x: station.x + dx * scale, y: station.y + dy * scale };
}

export function navSignalValid(distanceNmVal: number, maxNm = 120): boolean {
  return distanceNmVal <= maxNm;
}

/** Cone-of-confusion: close to station — instrument unstable. */
export function inConeOfConfusion(distanceNmVal: number, coneNm = 0.6): boolean {
  return distanceNmVal < coneNm;
}

export type InterceptMode = 'INBOUND' | 'OUTBOUND';

/**
 * Desired magnetic heading when established on a radial.
 * OUTBOUND on radial R: heading R.
 * INBOUND (toward station on radial R): heading reciprocal(R).
 */
export function onCourseHeading(radial: number, mode: InterceptMode): number {
  if (mode === 'OUTBOUND') return normalizeHeading(radial);
  return reciprocalCourse(radial);
}

/**
 * Signed cross-track: positive if aircraft is to the "right" of the infinite radial line
 * from station along direction `radial` (outbound). Used for "which side" text.
 */
export function crossTrackSign(
  station: { x: number; y: number },
  aircraft: { x: number; y: number },
  radialDeg: number
): number {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  const ux = Math.sin(θ);
  const uy = Math.cos(θ);
  const sx = aircraft.x - station.x;
  const sy = aircraft.y - station.y;
  return sx * uy - sy * ux;
}

/**
 * Rate of change of {@link crossTrackSign} per NM flown along `headingDeg` (same NM frame as positions).
 * Used to pick which of two ±lead intercept headings actually cuts toward the course line.
 */
export function crossTrackSignRate(
  _station: { x: number; y: number },
  _aircraft: { x: number; y: number },
  targetRadialDeg: number,
  headingDeg: number
): number {
  const θ = (normalizeHeading(targetRadialDeg) * Math.PI) / 180;
  const ux = Math.sin(θ);
  const uy = Math.cos(θ);
  const hr = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const ve = Math.sin(hr);
  const vn = Math.cos(hr);
  return ve * uy - vn * ux;
}

function pickInterceptHeadingTowardRadialLine(
  station: { x: number; y: number },
  aircraft: { x: number; y: number },
  targetRadial: number,
  hA: number,
  hB: number
): number {
  const c0 = crossTrackSign(station, aircraft, targetRadial);
  const rA = crossTrackSignRate(station, aircraft, targetRadial, hA);
  const rB = crossTrackSignRate(station, aircraft, targetRadial, hB);
  const helpsA = c0 !== 0 && rA * c0 < 0;
  const helpsB = c0 !== 0 && rB * c0 < 0;
  if (helpsA && !helpsB) return normalizeHeading(hA);
  if (helpsB && !helpsA) return normalizeHeading(hB);
  if (helpsA && helpsB) return normalizeHeading(Math.abs(rA) >= Math.abs(rB) ? hA : hB);
  const step = 0.02;
  const magAfter = (h: number) => {
    const rad = (normalizeHeading(h) * Math.PI) / 180;
    const nx = aircraft.x + Math.sin(rad) * step;
    const ny = aircraft.y + Math.cos(rad) * step;
    return Math.abs(crossTrackSign(station, { x: nx, y: ny }, targetRadial));
  };
  return normalizeHeading(magAfter(hA) <= magAfter(hB) ? hA : hB);
}

/**
 * Recommended magnetic heading to join the **target radial** with a lead angle.
 *
 * The course line in space is always the ray from the station along `targetRadial` (same line for
 * inbound and outbound; only the on-course heading differs).
 *
 * - **OUTBOUND** on R-###: established heading = `targetRadial`.
 * - **INBOUND** on R-###: established heading = reciprocal(`targetRadial`) (toward the station on that line).
 *
 * For lead &gt; 0 there are two headings at ±lead from on-course; the one that **flies toward** the
 * infinite course line (reduces |cross-track|) is chosen — not a fixed left/right rule, which can
 * pick a heading away from the line (e.g. 180° vs 360° for a 90° inbound intercept from the southwest).
 */
export function recommendedInterceptHeading(params: {
  aircraft: { x: number; y: number };
  station: { x: number; y: number };
  targetRadial: number;
  mode: InterceptMode;
  interceptAngleDeg: number;
  currentHeading: number;
}): {
  heading: number;
  turn: 'LEFT' | 'RIGHT';
  bearingToStation: number;
  currentRadial: number;
} {
  const { aircraft, station, targetRadial, mode, interceptAngleDeg, currentHeading } =
    params;
  const currentRadial = radialFromStation(station, aircraft);
  const brgTo = bearingToStation(currentRadial);
  const target = normalizeHeading(targetRadial);
  const lead = Math.max(0, interceptAngleDeg);

  let interceptHeading: number;
  if (lead <= 0) {
    interceptHeading = onCourseHeading(target, mode);
  } else if (mode === 'INBOUND') {
    const inboundHdg = reciprocalCourse(target);
    const hA = normalizeHeading(inboundHdg - lead);
    const hB = normalizeHeading(inboundHdg + lead);
    interceptHeading = pickInterceptHeadingTowardRadialLine(station, aircraft, target, hA, hB);
  } else {
    const outboundHdg = target;
    const hA = normalizeHeading(outboundHdg - lead);
    const hB = normalizeHeading(outboundHdg + lead);
    interceptHeading = pickInterceptHeadingTowardRadialLine(station, aircraft, target, hA, hB);
  }

  const turnDir =
    shortestSignedAngleDeg(currentHeading, interceptHeading) >= 0 ? 'RIGHT' : 'LEFT';

  return {
    heading: interceptHeading,
    turn: turnDir,
    bearingToStation: brgTo,
    currentRadial,
  };
}

/** Wind FROM direction and speed → ground velocity added to air vector (kts, NM coords). */
export function windComponentsFrom(windFromDeg: number, windSpeedKts: number): {
  east: number;
  north: number;
} {
  const r = (normalizeHeading(windFromDeg) * Math.PI) / 180;
  return {
    east: -windSpeedKts * Math.sin(r),
    north: -windSpeedKts * Math.cos(r),
  };
}

/** Ground speed components from heading and airspeed plus wind. */
export function groundVelocityKts(
  headingDeg: number,
  airspeedKts: number,
  windFromDeg: number,
  windSpeedKts: number
): { east: number; north: number; groundSpeed: number; track: number } {
  const h = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const airE = airspeedKts * Math.sin(h);
  const airN = airspeedKts * Math.cos(h);
  const w = windComponentsFrom(windFromDeg, windSpeedKts);
  const gE = airE + w.east;
  const gN = airN + w.north;
  const groundSpeed = Math.hypot(gE, gN);
  const track =
    groundSpeed < 0.01 ? normalizeHeading(headingDeg) : normalizeHeading(
      (Math.atan2(gE, gN) * 180) / Math.PI
    );
  return { east: gE, north: gN, groundSpeed, track };
}

/** Plain-language quadrant relative to station. */
export function cardinalRelativeToStation(
  station: { x: number; y: number },
  aircraft: { x: number; y: number }
): string {
  const dx = aircraft.x - station.x;
  const dy = aircraft.y - station.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 'at the station';
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return dx > 0 ? 'east' : 'west';
  if (ady > adx * 2) return dy > 0 ? 'north' : 'south';
  if (dx > 0 && dy > 0) return 'northeast';
  if (dx < 0 && dy > 0) return 'northwest';
  if (dx > 0 && dy < 0) return 'southeast';
  return 'southwest';
}
