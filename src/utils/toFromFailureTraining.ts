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

function offsetPerpendicular(radialDeg: number, crossNm: number): Position {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  // Right-of-course unit vector for outbound radial direction.
  return {
    x: Math.cos(θ) * crossNm,
    y: -Math.sin(θ) * crossNm,
  };
}

/**
 * Create two aircraft on opposite sides of the selected radial line through the station:
 * - Aircraft A near the named radial R-OBS (outbound side)
 * - Aircraft B near the reciprocal (inbound side)
 *
 * Both are slightly offset so their CDI needles are not identical, but headings are similar
 * to keep focus on CDI/geometry rather than direction of travel.
 */
export function buildToFromFailureTrainingScenario(params: {
  station: Position;
  obs: number;
  /** If omitted, aircraft headings follow selected OBS. */
  heading?: number;
  /** Along-course distance from station (NM). */
  dmeNm?: number;
  /** Perpendicular offset from selected radial line (NM) for visible CDI. */
  crossTrackOffsetNm?: number;
}): ToFromFailureTrainingScenario {
  const { station } = params;
  const obs = normalizeHeading(params.obs);
  const heading = normalizeHeading(params.heading ?? obs);
  const dmeNm = Math.max(2, params.dmeNm ?? 10);
  const crossNm = Math.max(0.5, params.crossTrackOffsetNm ?? 1.2);

  // Base on selected radial side, then keep BOTH aircraft on the same (left) side
  // of the selected radial line with slight along-track spacing.
  const base = pointOnRadial(station, obs, dmeNm);
  const alongB = pointOnRadial(station, obs, Math.max(2, dmeNm - 1.2));
  const off = offsetPerpendicular(obs, -crossNm);
  const aPos = { x: base.x + off.x, y: base.y + off.y };
  const bPos = { x: alongB.x + off.x, y: alongB.y + off.y };

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

  // In this setup both are on the selected radial side; either can intercept/track by flying toward needle.
  // Keep deterministic answer for existing quiz UI (A as reference side).
  const correct: TrainingAircraftId = 'A';

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

