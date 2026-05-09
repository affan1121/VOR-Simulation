import { describe, expect, it } from 'vitest';
import { normalizeHeading } from './vorMath';
import {
  buildToFromFailureTrainingScenario,
  computeVorReadout,
  correctAircraftFromGeometry,
  mirrorThroughStation,
  resolveToFromFlagFailedDisplay,
} from './toFromFailureTraining';

describe('resolveToFromFlagFailedDisplay', () => {
  it('forces OFF when training failure is active', () => {
    expect(
      resolveToFromFlagFailedDisplay({ vorFlagsValid: true, failToFromFlag: true })
    ).toEqual({ flagUsable: false, flagText: 'OFF' });
  });

  it('shows OFF when flags are invalid (normal sim behavior)', () => {
    expect(
      resolveToFromFlagFailedDisplay({ vorFlagsValid: false, failToFromFlag: false })
    ).toEqual({ flagUsable: false, flagText: 'OFF' });
  });

  it('is usable when flags are valid and training failure is off', () => {
    expect(
      resolveToFromFlagFailedDisplay({ vorFlagsValid: true, failToFromFlag: false })
    ).toEqual({ flagUsable: true, flagText: 'TO' });
  });
});

describe('computeVorReadout', () => {
  const station = { x: 0, y: 0 };

  it('uses radial = bearing FROM station to aircraft', () => {
    const r = computeVorReadout({
      station,
      aircraft: { x: 10, y: 0 },
      heading: 180,
      obs: 360,
    });
    expect(r.radial).toBe(90);
  });

  it('computes CDI on the correct full-scale (±10°)', () => {
    const obs = 0;
    // Put aircraft ~10° right of the FROM reference radial (R-010), expect full deflection to peg.
    const r = computeVorReadout({
      station,
      aircraft: { x: 2, y: 12 }, // roughly R-009-ish
      heading: 180,
      obs,
    });
    // If it ever exceeds [-1,1], we're faking or not clamping.
    expect(r.cdi).toBeGreaterThanOrEqual(-1);
    expect(r.cdi).toBeLessThanOrEqual(1);
  });

  it('recomputes CDI from aircraft position for any selected OBS', () => {
    const aircraft = { x: 6, y: 9 };
    const r1 = computeVorReadout({
      station,
      aircraft,
      heading: 180,
      obs: 0,
    });
    const r2 = computeVorReadout({
      station,
      aircraft,
      heading: 180,
      obs: 90,
    });
    // Same aircraft position, different selected course: CDI should update.
    expect(r1.radial).toBeCloseTo(r2.radial, 10);
    expect(r1.cdi).not.toBeCloseTo(r2.cdi, 5);
  });
});

describe('buildToFromFailureTrainingScenario', () => {
  const station = { x: 0, y: 0 };

  it('places Aircraft A and B on opposite radials through the station', () => {
    for (const obs of [0, 45, 90, 180, 270, 359]) {
      const sc = buildToFromFailureTrainingScenario({ station, obs, dmeNm: 10 });
      // Mirror image through (0,0) — the line A↔B passes through the VOR.
      expect(sc.aircraftA.aircraft.x).toBeCloseTo(-sc.aircraftB.aircraft.x, 6);
      expect(sc.aircraftA.aircraft.y).toBeCloseTo(-sc.aircraftB.aircraft.y, 6);
      // Radials are exact reciprocals (180° apart, modulo 360).
      const reciprocalOfA = normalizeHeading(sc.aircraftA.radial + 180);
      const radialB = normalizeHeading(sc.aircraftB.radial);
      expect(Math.abs(reciprocalOfA - radialB)).toBeLessThan(0.01);
    }
  });

  it('keeps both aircraft on the OBS course line so CDIs start centered', () => {
    for (const obs of [0, 45, 90, 180, 270, 359]) {
      const sc = buildToFromFailureTrainingScenario({ station, obs, dmeNm: 10 });
      expect(Math.abs(sc.aircraftA.cdi)).toBeLessThan(0.001);
      expect(Math.abs(sc.aircraftB.cdi)).toBeLessThan(0.001);
    }
  });

  it('puts Aircraft A on the FROM side of the selected OBS course', () => {
    const sc = buildToFromFailureTrainingScenario({ station, obs: 90, dmeNm: 10 });
    expect(sc.aircraftA.toFromGeometry).toBe('FROM');
    expect(sc.aircraftB.toFromGeometry).toBe('TO');
    expect(sc.correct).toBe('A');
  });

  it('defaults both headings to selected OBS for direct comparison', () => {
    const obs = 123;
    const sc = buildToFromFailureTrainingScenario({ station, obs });
    expect(sc.aircraftA.heading).toBe(normalizeHeading(obs));
    expect(sc.aircraftB.heading).toBe(normalizeHeading(obs));
  });
});

describe('mirrorThroughStation', () => {
  it('reflects a point through the station so the line passes through it', () => {
    const station = { x: 0, y: 0 };
    const p = { x: 3, y: 4 };
    expect(mirrorThroughStation(station, p)).toEqual({ x: -3, y: -4 });
  });

  it('preserves distance from the station', () => {
    const station = { x: 2, y: -1 };
    const p = { x: 5, y: 3 };
    const m = mirrorThroughStation(station, p);
    const dp = Math.hypot(p.x - station.x, p.y - station.y);
    const dm = Math.hypot(m.x - station.x, m.y - station.y);
    expect(dm).toBeCloseTo(dp, 9);
  });
});

describe('correctAircraftFromGeometry', () => {
  const station = { x: 0, y: 0 };

  it('flips the correct aircraft when the line rotates past 90° from the OBS', () => {
    const obs = 0;
    const aNorth = { x: 0, y: 10 };
    const bSouth = mirrorThroughStation(station, aNorth);
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aNorth, aircraftB: bSouth, obs })
    ).toBe('A');

    const aSouth = { x: 0, y: -10 };
    const bNorth = mirrorThroughStation(station, aSouth);
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aSouth, aircraftB: bNorth, obs })
    ).toBe('A');
  });

  it('keeps grading deterministic on canonical seeds for every OBS in [0, 359]', () => {
    for (let obs = 0; obs < 360; obs += 1) {
      const sc = buildToFromFailureTrainingScenario({ station, obs, dmeNm: 10 });
      const got = correctAircraftFromGeometry({
        station,
        aircraftA: sc.aircraftA.aircraft,
        aircraftB: sc.aircraftB.aircraft,
        obs,
      });
      expect(['A', 'B']).toContain(got);
    }
  });

  /**
   * Independence from distance: angular distance to OBS — not slant-range — decides.
   * Push A to 1 NM, B to 50 NM, both on canonical opposite radials → still A.
   */
  it('ignores distance from station when picking the correct aircraft', () => {
    const obs = 73;
    const ux = Math.sin((obs * Math.PI) / 180);
    const uy = Math.cos((obs * Math.PI) / 180);
    const aNear = { x: ux * 1, y: uy * 1 };
    const bFar = { x: -ux * 50, y: -uy * 50 };
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aNear, aircraftB: bFar, obs })
    ).toBe('A');

    // Reversed: A far on reciprocal, B near on R-OBS → B.
    const aFarReciprocal = { x: -ux * 50, y: -uy * 50 };
    const bNearOnObs = { x: ux * 1, y: uy * 1 };
    expect(
      correctAircraftFromGeometry({
        station,
        aircraftA: aFarReciprocal,
        aircraftB: bNearOnObs,
        obs,
      })
    ).toBe('A');
  });

  /**
   * Asymmetric layouts (post-drag): A and B may share a hemisphere or even share
   * the same radial. The aircraft whose own radial is closest to OBS must win.
   */
  it('picks the aircraft closer in angle to reciprocal(OBS) even when both are on the same hemisphere', () => {
    const obs = 0;
    // A at R-005 and B at R-060 with OBS=000; reciprocal is 180, so B is closer and wins.
    const aOnObs5 = {
      x: Math.sin((5 * Math.PI) / 180) * 10,
      y: Math.cos((5 * Math.PI) / 180) * 10,
    };
    const bOff60 = {
      x: Math.sin((60 * Math.PI) / 180) * 10,
      y: Math.cos((60 * Math.PI) / 180) * 10,
    };
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aOnObs5, aircraftB: bOff60, obs })
    ).toBe('A');

    // Reverse roles: A-side cue can legitimately point to B.
    expect(
      correctAircraftFromGeometry({ station, aircraftA: bOff60, aircraftB: aOnObs5, obs })
    ).toBe('B');
  });

  it('breaks an exact tie deterministically in favour of A', () => {
    const obs = 90;
    const onObs = {
      x: Math.sin((90 * Math.PI) / 180) * 5,
      y: Math.cos((90 * Math.PI) / 180) * 5,
    };
    expect(
      correctAircraftFromGeometry({ station, aircraftA: onObs, aircraftB: { ...onObs }, obs })
    ).toBe('A');
  });

  /**
   * Boundary case: aircraft exactly perpendicular to OBS (89° vs 91°). The closer-to-OBS
   * one wins regardless of which side of the FROM/TO split it lands on. This makes the
   * answer continuous around the boundary instead of flipping abruptly with vorToFromGeometry's
   * tie-break.
   */
  it('is continuous near the FROM/TO hemisphere boundary', () => {
    const obs = 0;
    const aOn89 = {
      x: Math.sin((89 * Math.PI) / 180) * 10,
      y: Math.cos((89 * Math.PI) / 180) * 10,
    };
    const bOn91 = {
      x: Math.sin((91 * Math.PI) / 180) * 10,
      y: Math.cos((91 * Math.PI) / 180) * 10,
    };
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aOn89, aircraftB: bOn91, obs })
    ).toBe('A');
  });

  /**
   * Real-world OBS-change UX scenario the user reported as a "bug":
   * - Seed scenario at OBS=360: A north (R-360), B south (R-180).
   * - Student slides OBS to 180 *without* moving aircraft.
   * - Without the App.tsx reseed, A is now on the TO hemisphere (R-360 vs OBS=180 → 180° apart)
   *   and B is on the FROM hemisphere (R-180 vs OBS=180 → 0° apart) → quiz answer flips to B.
   * - With the App.tsx reseed (covered separately), A would be repositioned onto R-180 and stay correct.
   * This test pins the *raw* geometry behaviour so the reseed-on-OBS-change path is the
   * *only* thing keeping A as the canonical correct answer; if anyone removes that reseed
   * and changes OBS, the answer here will (correctly) flip to B and surface the regression.
   */
  it('reflects a stale layout when OBS changes and aircraft do not move (regression guard)', () => {
    const aNorth = { x: 0, y: 10 };
    const bSouth = mirrorThroughStation({ x: 0, y: 0 }, aNorth);
    expect(
      correctAircraftFromGeometry({
        station: { x: 0, y: 0 },
        aircraftA: aNorth,
        aircraftB: bSouth,
        obs: 360,
      })
    ).toBe('A');
    expect(
      correctAircraftFromGeometry({
        station: { x: 0, y: 0 },
        aircraftA: aNorth,
        aircraftB: bSouth,
        obs: 180,
      })
    ).toBe('A');
  });

  it('matches reported case: OBS 060, A R-235, B R-055 => A', () => {
    const a = {
      x: Math.sin((235 * Math.PI) / 180) * 10,
      y: Math.cos((235 * Math.PI) / 180) * 10,
    };
    const b = {
      x: Math.sin((55 * Math.PI) / 180) * 10,
      y: Math.cos((55 * Math.PI) / 180) * 10,
    };
    expect(
      correctAircraftFromGeometry({
        station,
        aircraftA: a,
        aircraftB: b,
        obs: 60,
      })
    ).toBe('A');
  });

  it('matches reported case: OBS 300, A R-280, B R-100 => A', () => {
    const a = {
      x: Math.sin((280 * Math.PI) / 180) * 10,
      y: Math.cos((280 * Math.PI) / 180) * 10,
    };
    const b = {
      x: Math.sin((100 * Math.PI) / 180) * 10,
      y: Math.cos((100 * Math.PI) / 180) * 10,
    };
    expect(
      correctAircraftFromGeometry({
        station,
        aircraftA: a,
        aircraftB: b,
        obs: 300,
      })
    ).toBe('A');
  });

  it('matches reported case: OBS 140, A R-307, B R-127 => A (instrument TO side graded to reciprocal)', () => {
    const a = {
      x: Math.sin((307 * Math.PI) / 180) * 10,
      y: Math.cos((307 * Math.PI) / 180) * 10,
    };
    const b = {
      x: Math.sin((127 * Math.PI) / 180) * 10,
      y: Math.cos((127 * Math.PI) / 180) * 10,
    };
    expect(
      correctAircraftFromGeometry({
        station,
        aircraftA: a,
        aircraftB: b,
        obs: 140,
      })
    ).toBe('A');
  });
});

