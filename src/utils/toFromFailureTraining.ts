import type { Position } from '../types';
import {
  bearingToStation,
  distanceNm,
  normalizeHeading,
  reciprocalCourse,
  radialFromStation,
  shortestSignedAngleDeg,
  vorCdiNeedleFromCourseError,
  vorCourseErrorDeg,
  vorToFromGeometry,
} from './vorMath';

/**
 * TO/FROM Flag Failure Training Mode (teaching-only).
 *
 * This module intentionally does NOT change the simulator's core VOR logic.
 * Instead, it:
 * - Computes VOR readings for arbitrary aircraft using the same pure math helpers
 * - Generates a comparison setup (Aircraft A vs B) so students practice without TO/FROM
 */

export type VORReadout = {
  aircraft: Position;
  heading: number;
  obs: number;
  radial: number;
  bearingToStation: number;
  dmeNm: number;
  /** True TO/FROM sense (geometry only; never "AMBIGUOUS"). */
  toFromGeometry: 'TO' | 'FROM';
  courseErrorDeg: number;
  /** CDI needle: -1 left ... +1 right (cockpit sense: "fly toward the needle"). */
  cdi: number;
};

export function computeVorReadout(params: {
  station: Position;
  aircraft: Position;
  heading: number;
  obs: number;
}): VORReadout {
  const { station, aircraft, heading, obs } = params;
  const radial = radialFromStation(station, aircraft);
  const toFromGeometry = vorToFromGeometry(radial, obs);
  const courseErrorDeg = vorCourseErrorDeg(radial, obs, toFromGeometry);
  const cdi = vorCdiNeedleFromCourseError(courseErrorDeg);
  return {
    aircraft: { ...aircraft },
    heading: normalizeHeading(heading),
    obs: normalizeHeading(obs),
    radial,
    bearingToStation: bearingToStation(radial),
    dmeNm: distanceNm(station, aircraft),
    toFromGeometry,
    courseErrorDeg,
    cdi,
  };
}

export type TrainingAircraftId = 'A' | 'B';

export type ToFromFailureTrainingScenario = {
  obs: number;
  aircraftA: VORReadout;
  aircraftB: VORReadout;
  correct: TrainingAircraftId;
  /** CDI / needle shown in the panel — always the graded (correct) aircraft for OFF-flag drills. */
  vorInstrument: VORReadout;
};

function pointOnRadial(station: Position, radialDeg: number, nmOut: number): Position {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  return {
    x: station.x + Math.sin(θ) * nmOut,
    y: station.y + Math.cos(θ) * nmOut,
  };
}

/**
 * Mirror a point through the VOR station so that A and B always sit on opposite radials.
 *
 * The line connecting A and B passes exactly through the station — this is the constraint
 * the student manipulates: rotating the pair 360° around the VOR while keeping them
 * on opposite radials.
 */
export function mirrorThroughStation(station: Position, p: Position): Position {
  return { x: 2 * station.x - p.x, y: 2 * station.y - p.y };
}

/**
 * Determine which aircraft is on the side Aircraft A would intercept using
 * TO/FROM-side exam logic.
 *
 * Training intent:
 * - The displayed instrument belongs to Aircraft A, so students solve from A's cue.
 * - If A is FROM side, grade against OBS (top of OBS).
 * - If A is TO side, grade against reciprocal(OBS) (bottom of OBS).
 *
 * Then choose whichever aircraft is closer in angular distance to that target radial.
 * Ties resolve to A for deterministic behavior.
 */
export function correctAircraftFromGeometry(params: {
  station: Position;
  aircraftA: Position;
  aircraftB: Position;
  obs: number;
}): TrainingAircraftId {
  const { station, aircraftA, aircraftB, obs } = params;
  const radA = radialFromStation(station, aircraftA);
  const radB = radialFromStation(station, aircraftB);
  const aToFrom = vorToFromGeometry(radA, obs);
  const targetRadial = aToFrom === 'FROM' ? normalizeHeading(obs) : reciprocalCourse(obs);
  const errA = Math.abs(shortestSignedAngleDeg(targetRadial, radA));
  const errB = Math.abs(shortestSignedAngleDeg(targetRadial, radB));
  if (errA < errB) return 'A';
  if (errB < errA) return 'B';
  return 'A';
}

/** Small exam-style manoeuvre after setting heading to OBS lubber ("top of OBS"). */
const INTERCEPT_NEEDLE_DELTA_DEG = 6;
const INTERCEPT_NEEDLE_STEP_NM = 5;
const CDI_NEARLY_CENTERED_EPS = 1e-5;

function errDegToTrackedRadial(station: Position, p: Position, trackedRadialDeg: number): number {
  const r = radialFromStation(station, p);
  return Math.abs(shortestSignedAngleDeg(normalizeHeading(trackedRadialDeg), r));
}

function positionAfterFlyingHeadingNm(p: Position, headingDeg: number, nm: number): Position {
  const θ = (normalizeHeading(headingDeg) * Math.PI) / 180;
  return {
    x: p.x + Math.sin(θ) * nm,
    y: p.y + Math.cos(θ) * nm,
  };
}

/**
 * Reduction in radial error toward `trackedRadialDeg` after a tiny turn in the cockpit
 * "fly toward the needle" sense (CDI left means turn left a few magnetic degrees, then fly a short NM).
 * Uses heading = OBS for both aircraft—the exam procedural setup the student described.
 *
 * Larger positive score ⇒ that aircraft matches the intercept implied by needle deflection.
 */
function interceptNeedleCueScore(params: {
  station: Position;
  aircraft: Position;
  obsDeg: number;
  trackedRadialDeg: number;
  headingForObsCoupling: number;
  obsCourse: number;
}): number {
  const {
    station,
    aircraft,
    obsDeg,
    trackedRadialDeg,
    headingForObsCoupling,
    obsCourse,
  } = params;
  const obsN = normalizeHeading(obsDeg);

  const rAtObsHeading = computeVorReadout({
    station,
    aircraft,
    heading: headingForObsCoupling,
    obs: obsCourse,
  });

  const errBefore = errDegToTrackedRadial(station, aircraft, trackedRadialDeg);

  if (Math.abs(rAtObsHeading.cdi) < CDI_NEARLY_CENTERED_EPS) {
    return -errBefore;
  }

  const turnSign = rAtObsHeading.cdi < 0 ? -1 : 1;
  const steerHeading = normalizeHeading(obsN + turnSign * INTERCEPT_NEEDLE_DELTA_DEG);
  const pAfter = positionAfterFlyingHeadingNm(aircraft, steerHeading, INTERCEPT_NEEDLE_STEP_NM);
  const errAfter = errDegToTrackedRadial(station, pAfter, trackedRadialDeg);
  return errBefore - errAfter;
}

/**
 * TO/FFROM-failure quiz: which airplane is paired with the deflected needle when both are
 * first aligned to the OBS lubber heading, then flown a notch toward their own needle direction
 * toward the graded radial leg (OBS from top lubber if Aircraft A is FROM; reciprocal if TO).
 *
 * When the manoeuvre favours neither, falls back to {@link correctAircraftFromGeometry}.
 */
export function correctAircraftFromInterceptCue(params: {
  station: Position;
  aircraftA: Position;
  aircraftB: Position;
  obs: number;
}): TrainingAircraftId {
  const { station, aircraftA, aircraftB, obs } = params;
  const obsN = normalizeHeading(obs);

  const headingFaceObs = obsN;

  const readAobs = computeVorReadout({
    station,
    aircraft: aircraftA,
    heading: headingFaceObs,
    obs: obsN,
  });
  const readBobs = computeVorReadout({
    station,
    aircraft: aircraftB,
    heading: headingFaceObs,
    obs: obsN,
  });

  const signCdi = (cdi: number) =>
    cdi < -CDI_NEARLY_CENTERED_EPS ? -1 : cdi > CDI_NEARLY_CENTERED_EPS ? 1 : 0;

  const sA = signCdi(readAobs.cdi);
  const sB = signCdi(readBobs.cdi);

  /*
   * Opposite needle polarity: both aircraft on the perpendicular “green line” candidates
   * (INRAT OFF-flag drill) with **the same OBS lubber heading**. The CDI then identifies which
   * radial you are on: needle left ⇒ the aircraft whose CDI is left is correct; needle right ⇒
   * the aircraft whose CDI is right (see vor-off-indications.pdf).
   */
  if (sA !== 0 && sB !== 0 && sA !== sB) {
    return readAobs.cdi < readBobs.cdi ? 'A' : 'B';
  }

  const aToFrom = vorToFromGeometry(readAobs.radial, obsN);
  const trackedRadial = aToFrom === 'FROM' ? obsN : reciprocalCourse(obsN);

  const scoreA = interceptNeedleCueScore({
    station,
    aircraft: aircraftA,
    obsDeg: obsN,
    trackedRadialDeg: trackedRadial,
    headingForObsCoupling: headingFaceObs,
    obsCourse: obsN,
  });
  const scoreB = interceptNeedleCueScore({
    station,
    aircraft: aircraftB,
    obsDeg: obsN,
    trackedRadialDeg: trackedRadial,
    headingForObsCoupling: headingFaceObs,
    obsCourse: obsN,
  });

  if (scoreA > scoreB + 1e-9) return 'A';
  if (scoreB > scoreA + 1e-9) return 'B';
  return correctAircraftFromGeometry(params);
}

/**
 * Create two aircraft on opposite radials through the station, connected by a
 * conceptual line that passes through the VOR. The student rotates this line
 * 360° around the station by dragging either aircraft on the map.
 *
 * Initial geometry:
 * - Aircraft A on R-OBS (named radial, FROM side) at `dmeNm`.
 * - Aircraft B on R-(OBS+180) (reciprocal, TO side) at `dmeNm`.
 *
 * Both start on the OBS course line so CDIs are centered; rotating the line off the
 * OBS course makes their CDIs deflect in opposite senses (mirror through the station).
 */
export function buildToFromFailureTrainingScenario(params: {
  station: Position;
  obs: number;
  /** If omitted, aircraft headings follow selected OBS. */
  heading?: number;
  /** Distance from station (NM) for both aircraft. */
  dmeNm?: number;
}): ToFromFailureTrainingScenario {
  const { station } = params;
  const obs = normalizeHeading(params.obs);
  const heading = normalizeHeading(params.heading ?? obs);
  const dmeNm = Math.max(2, params.dmeNm ?? 10);

  const aPos = pointOnRadial(station, obs, dmeNm);
  const bPos = mirrorThroughStation(station, aPos);

  const aircraftA = computeVorReadout({
    station,
    aircraft: aPos,
    heading,
    obs,
  });
  const aircraftB = computeVorReadout({
    station,
    aircraft: bPos,
    heading,
    obs,
  });

  const correct = correctAircraftFromInterceptCue({
    station,
    aircraftA: aPos,
    aircraftB: bPos,
    obs,
  });
  const vorInstrument = correct === 'A' ? aircraftA : aircraftB;

  return { obs, aircraftA, aircraftB, correct, vorInstrument };
}

export function resolveToFromFlagFailedDisplay(params: {
  /** Normal instrument availability (nav range + not in cone + not on boundary). */
  vorFlagsValid: boolean;
  /** Training toggle: intentionally fail/hide the flag. */
  failToFromFlag: boolean;
}): {
  /** Whether the flag should be shown as usable. */
  flagUsable: boolean;
  /** What the flag window should show (TO/FR/OFF). */
  flagText: 'TO' | 'FR' | 'OFF';
} {
  const { vorFlagsValid, failToFromFlag } = params;
  if (failToFromFlag) return { flagUsable: false, flagText: 'OFF' };
  if (!vorFlagsValid) return { flagUsable: false, flagText: 'OFF' };
  return { flagUsable: true, flagText: 'TO' }; // actual TO/FR text is chosen by caller from toFrom
}

