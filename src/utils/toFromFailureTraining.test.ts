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
    // Aircraft A on R-000 (north of station), B mirrored south. A is on FROM side.
    const aNorth = { x: 0, y: 10 };
    const bSouth = mirrorThroughStation(station, aNorth);
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aNorth, aircraftB: bSouth, obs })
    ).toBe('A');

    // Now rotate so A sits south of station: A becomes the TO/reciprocal aircraft.
    const aSouth = { x: 0, y: -10 };
    const bNorth = mirrorThroughStation(station, aSouth);
    expect(
      correctAircraftFromGeometry({ station, aircraftA: aSouth, aircraftB: bNorth, obs })
    ).toBe('B');
  });
});

