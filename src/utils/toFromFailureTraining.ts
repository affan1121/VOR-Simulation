import type { Position } from '../types';
import {
  bearingToStation,
  distanceNm,
  normalizeHeading,
  radialFromStation,
  VOR_CDI_FULL_SCALE_DEG,
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
  const cdi = vorCdiNeedleFromCourseError(courseErrorDeg, VOR_CDI_FULL_SCALE_DEG);
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
  /**
   * Correct aircraft for: "Which aircraft is on the correct side to track the selected radial?"
   *
   * In this training mode we define "correct" as the aircraft on the same **named radial**
   * as the OBS (i.e. the outbound side of the course line, where a normal flag would show FROM).
   */
  correct: TrainingAircraftId;
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
 * Determine which aircraft is on the named radial R-OBS (the FROM hemisphere of the
 * selected course). With TO/FROM flag failed, the student must use position awareness
 * to identify this aircraft.
 *
 * Geometry: an aircraft at radial α is on the FROM hemisphere of OBS β when
 * cos(α − β) ≥ 0, i.e. |α − β| ≤ 90° (mod 360).
 */
export function correctAircraftFromGeometry(params: {
  station: Position;
  aircraftA: Position;
  aircraftB: Position;
  obs: number;
}): TrainingAircraftId {
  const { station, aircraftA, aircraftB, obs } = params;
  const radA = radialFromStation(station, aircraftA);
  const tfA = vorToFromGeometry(radA, obs);
  if (tfA === 'FROM') return 'A';
  const radB = radialFromStation(station, aircraftB);
  const tfB = vorToFromGeometry(radB, obs);
  if (tfB === 'FROM') return 'B';
  // Degenerate case (both on the boundary): default to A.
  return 'A';
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

  const correct = correctAircraftFromGeometry({
    station,
    aircraftA: aPos,
    aircraftB: bPos,
    obs,
  });

  return { obs, aircraftA, aircraftB, correct };
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

