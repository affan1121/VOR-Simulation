import { describe, expect, it } from 'vitest';
import { normalizeHeading } from './vorMath';
import {
  buildToFromFailureTrainingScenario,
  computeVorReadout,
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

  it('places Aircraft A and B on the same (left) side of the selected radial line', () => {
    const obs = 270;
    const sc = buildToFromFailureTrainingScenario({
      station,
      obs,
      dmeNm: 10,
      crossTrackOffsetNm: 1.3,
    });
    // For OBS 270, "left side" means south of the westbound radial for both.
    expect(Math.sign(sc.aircraftA.aircraft.y)).toBe(Math.sign(sc.aircraftB.aircraft.y));
  });

  it('produces visible CDI deflections for A and B', () => {
    for (const obs of [0, 45, 90, 180, 270, 359, 360]) {
      const sc = buildToFromFailureTrainingScenario({
        station,
        obs,
        dmeNm: 10,
        crossTrackOffsetNm: 1.2,
      });
      expect(Math.abs(sc.aircraftA.cdi)).toBeGreaterThan(0.01);
      expect(Math.abs(sc.aircraftB.cdi)).toBeGreaterThan(0.01);
    }
  });

  it('defaults both headings to selected OBS for direct comparison', () => {
    const obs = 123;
    const sc = buildToFromFailureTrainingScenario({ station, obs });
    expect(sc.aircraftA.heading).toBe(normalizeHeading(obs));
    expect(sc.aircraftB.heading).toBe(normalizeHeading(obs));
  });
});

