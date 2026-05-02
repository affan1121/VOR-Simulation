/**
 * VOR navigation math for training simulation.
 * Coordinate system: +Y = north, +X = east (magnetic). Distances in NM.
 */

/** Course-error ° that pegs the CDI (training VOR). */
export const VOR_CDI_FULL_SCALE_DEG = 10;

/** Lateral deviation-dot spacing on the CDI face (° between marks from centerline). */
export const VOR_CDI_DOT_STEP_DEG = 2;

/** Normalize any heading/course to [0, 360). */
export function normalizeHeading(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
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
 * Positive ⇒ aircraft is to the **right** of the course line when facing outbound along OBS.
 * The simulator negates needle deflection from this value so the CDI reads FAA-style (toward needle).
 */
export function vorCourseErrorDeg(
  radialDeg: number,
  obsDeg: number,
  toFrom: 'TO' | 'FROM'
): number {
  const ref = referenceRadialForCdi(obsDeg, toFrom);
  return shortestSignedAngleDeg(ref, normalizeHeading(radialDeg));
}

/**
 * CDI scale: full needle deflection at ±fullScaleDeg (typically 10° for VOR).
 * Returns raw -1..1 from course error (positive course error ⇒ positive raw).
 * Snapshot applies a sign flip so +needle on the gauge means “fly right.”
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
 * Recommended intercept heading to join `targetRadial`.
 * INBOUND: fly toward station on that radial — established inbound heading = reciprocal(targetRadial).
 * OUTBOUND: established heading = targetRadial.
 * Uses lead-angle geometry: from the "right" of the course line (outbound along `targetRadial`),
 * subtract the intercept angle from the on-course heading so you turn left and cut in (and vice versa).
 * Same ±rule for INBOUND and OUTBOUND — outbound branch matched INBOUND signs (Feb 2026 fix).
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
  const side = crossTrackSign(station, aircraft, target);
  const joinFromRight = side > 0;

  let interceptHeading: number;
  if (mode === 'INBOUND') {
    const inboundHdg = reciprocalCourse(target);
    interceptHeading = normalizeHeading(
      inboundHdg + (joinFromRight ? -interceptAngleDeg : interceptAngleDeg)
    );
  } else {
    const outboundHdg = target;
    interceptHeading = normalizeHeading(
      outboundHdg + (joinFromRight ? -interceptAngleDeg : interceptAngleDeg)
    );
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
