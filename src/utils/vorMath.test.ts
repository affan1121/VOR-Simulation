import { describe, expect, it } from 'vitest';
import {
  bearingToStation,
  cardinalRelativeToStation,
  cdiNeedleDeflection,
  crossTrackSign,
  distanceNm,
  groundVelocityKts,
  inConeOfConfusion,
  navSignalValid,
  normalizeHeading,
  onCourseHeading,
  radialFromStation,
  reciprocalCourse,
  recommendedInterceptHeading,
  referenceRadialForCdi,
  shortestSignedAngleDeg,
  stationPassage,
  VOR_CDI_FULL_SCALE_DEG,
  vorCourseErrorDeg,
  VOR_FLAG_BOUNDARY_MAX_DEG,
  vorOnToFromHemisphereBoundary,
  vorToFrom,
  windComponentsFrom,
  MAP_PLAN_VIEW_HALF_NM,
  MAP_PLAN_DME_MARGIN_NM,
  maxDistanceNmAlongRadialInPlanView,
  maxDistanceNmAlongRadialInExtents,
  clampAircraftPositionToStationExtents,
} from './vorMath';

describe('normalizeHeading', () => {
  it('wraps to 0–359', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-1)).toBe(359);
    expect(normalizeHeading(721)).toBe(1);
  });
});

describe('reciprocalCourse', () => {
  it('adds 180 and normalizes', () => {
    expect(reciprocalCourse(0)).toBe(180);
    expect(reciprocalCourse(270)).toBe(90);
    expect(reciprocalCourse(90)).toBe(270);
  });
});

describe('shortestSignedAngleDeg', () => {
  it('returns shortest turn', () => {
    expect(shortestSignedAngleDeg(350, 10)).toBe(20);
    expect(shortestSignedAngleDeg(10, 350)).toBe(-20);
    expect(shortestSignedAngleDeg(90, 270)).toBe(180);
    expect(shortestSignedAngleDeg(270, 90)).toBe(-180);
  });
});

describe('radialFromStation', () => {
  const st = { x: 0, y: 0 };

  it('north of station is 360/0 radial', () => {
    expect(radialFromStation(st, { x: 0, y: 10 })).toBe(0);
  });
  it('east of station is 090', () => {
    expect(radialFromStation(st, { x: 10, y: 0 })).toBe(90);
  });
  it('south of station is 180', () => {
    expect(radialFromStation(st, { x: 0, y: -10 })).toBe(180);
  });
  it('west of station is 270', () => {
    expect(radialFromStation(st, { x: -10, y: 0 })).toBe(270);
  });
});

describe('bearingToStation', () => {
  it('is reciprocal of radial', () => {
    expect(bearingToStation(90)).toBe(270);
    expect(bearingToStation(180)).toBe(0);
  });
});

describe('vorToFrom', () => {
  /** cos(|r−o|)<0 → TO hemisphere; ambiguity threshold 0 for explicit edges in unit tests below. */
  const noAmb = 0;

  it('FROM when on outbound side of OBS', () => {
    expect(vorToFrom(360, 360, 0)).toBe('FROM');
    expect(vorToFrom(90, 90, 0)).toBe('FROM');
  });
  it('TO when on inbound side', () => {
    expect(vorToFrom(180, 360, 0)).toBe('TO');
    expect(vorToFrom(270, 90, 0)).toBe('TO');
  });

  it('matches cos(r−o) hemisphere for every cardinal OBS × offset radial (no threshold)', () => {
    const obsList = [0, 90, 180, 270, 360];
    const deltas = [-60, -30, 30, 60];
    for (const obs of obsList) {
      for (const d of deltas) {
        const r = normalizeHeading(obs + d);
        const cosab = Math.cos(
          ((normalizeHeading(r) - normalizeHeading(obs)) * Math.PI) / 180
        );
        const expected = cosab > 0 ? 'FROM' : 'TO';
        expect(vorToFrom(r, obs, noAmb)).toBe(expected);
      }
    }
  });

  it('is AMBIGUOUS when abeam (|cos| below default threshold)', () => {
    expect(vorToFrom(90, 0)).toBe('AMBIGUOUS');
    expect(vorToFrom(270, 0)).toBe('AMBIGUOUS');
    expect(vorToFrom(0, 90)).toBe('AMBIGUOUS');
  });

  it('vorOnToFromHemisphereBoundary is sub-degree on OBS±90° line (not a wide cosine wedge)', () => {
    expect(vorOnToFromHemisphereBoundary(90, 0)).toBe(true);
    expect(vorOnToFromHemisphereBoundary(270, 0)).toBe(true);
    expect(vorOnToFromHemisphereBoundary(90.25, 0)).toBe(false);
    expect(vorOnToFromHemisphereBoundary(87, 0)).toBe(false);
    /** Default vorToFrom ambiguity is still several degrees wide at 0.05 — flags do not use that. */
    expect(vorToFrom(87, 0)).toBe('FROM');
    expect(vorToFrom(87, 0, 0.05)).toBe('FROM');
    expect(VOR_FLAG_BOUNDARY_MAX_DEG).toBeLessThan(0.5);
  });

  it('FROM/TO from aircraft position matches radial-based vorToFrom', () => {
    const st = { x: 0, y: 0 };
    const obs = 45;
    const positions: { ac: { x: number; y: number }; expect: 'TO' | 'FROM' }[] = [
      { ac: pointOnRadial(st, 45, 8), expect: 'FROM' },
      { ac: pointOnRadial(st, 225, 8), expect: 'TO' },
      { ac: pointOnRadial(st, 30, 8), expect: 'FROM' },
      { ac: pointOnRadial(st, 240, 8), expect: 'TO' },
    ];
    for (const { ac, expect: exp } of positions) {
      const r = radialFromStation(st, ac);
      expect(vorToFrom(r, obs, noAmb)).toBe(exp);
    }
  });
});

describe('referenceRadialForCdi and vorCourseErrorDeg', () => {
  it('centers FROM on outbound radial', () => {
    const obs = 360;
    expect(referenceRadialForCdi(obs, 'FROM')).toBe(0);
    expect(vorCourseErrorDeg(360, obs, 'FROM')).toBe(0);
  });
  it('centers TO on reciprocal radial', () => {
    const obs = 360;
    expect(referenceRadialForCdi(obs, 'TO')).toBe(180);
    expect(vorCourseErrorDeg(180, obs, 'TO')).toBe(0);
  });
  it('CDI error 10° gives full deflection at default scale', () => {
    const e = vorCourseErrorDeg(10, 0, 'FROM');
    expect(cdiNeedleDeflection(e, VOR_CDI_FULL_SCALE_DEG)).toBe(1);
  });

  it('zero course error exactly on reference radial for many OBS × TO/FROM', () => {
    const obsValues = [0, 1, 90, 127, 180, 270, 359, 360];
    for (const obs of obsValues) {
      for (const tf of ['FROM', 'TO'] as const) {
        const ref = referenceRadialForCdi(obs, tf);
        expect(vorCourseErrorDeg(ref, obs, tf)).toBe(0);
        expect(vorCourseErrorDeg(normalizeHeading(ref), obs, tf)).toBe(0);
      }
    }
  });

  it('course error equals shortest angle ref → aircraft radial', () => {
    for (const obs of [0, 45, 90, 200]) {
      for (const tf of ['FROM', 'TO'] as const) {
        const ref = referenceRadialForCdi(obs, tf);
        for (const off of [-9, -3, 3, 9]) {
          const r = normalizeHeading(ref + off);
          expect(vorCourseErrorDeg(r, obs, tf)).toBe(
            shortestSignedAngleDeg(ref, r)
          );
        }
      }
    }
  });
});

describe('cdiNeedleDeflection (course deviation indicator)', () => {
  it('clamps to ±1', () => {
    expect(cdiNeedleDeflection(15, VOR_CDI_FULL_SCALE_DEG)).toBe(1);
    expect(cdiNeedleDeflection(-20, VOR_CDI_FULL_SCALE_DEG)).toBe(-1);
  });

  it('linear within ±full scale', () => {
    expect(cdiNeedleDeflection(0)).toBe(0);
    expect(cdiNeedleDeflection(5)).toBe(0.5);
    expect(cdiNeedleDeflection(-7.5)).toBe(-0.75);
  });

  it('needle sign tracks course-error sign (fly toward needle)', () => {
    const pairs: [number, number][] = [
      [4, 0.4],
      [-6, -0.6],
    ];
    for (const [err, needle] of pairs) {
      expect(cdiNeedleDeflection(err)).toBeCloseTo(needle, 10);
      expect(Math.sign(cdiNeedleDeflection(err))).toBe(Math.sign(err));
    }
  });

  it('FROM: right of OBS line ⇒ positive error ⇒ positive needle (geometry)', () => {
    const st = { x: 0, y: 0 };
    const obs = 90;
    const acRight = { x: 10, y: -4 };
    const acLeft = { x: 10, y: 4 };
    const rR = radialFromStation(st, acRight);
    const rL = radialFromStation(st, acLeft);
    expect(crossTrackSign(st, acRight, obs)).toBeGreaterThan(0);
    expect(crossTrackSign(st, acLeft, obs)).toBeLessThan(0);
    expect(vorCourseErrorDeg(rR, obs, 'FROM')).toBeGreaterThan(0);
    expect(vorCourseErrorDeg(rL, obs, 'FROM')).toBeLessThan(0);
    expect(cdiNeedleDeflection(vorCourseErrorDeg(rR, obs, 'FROM'))).toBeGreaterThan(0);
    expect(cdiNeedleDeflection(vorCourseErrorDeg(rL, obs, 'FROM'))).toBeLessThan(0);
  });

  it('TO: small perpendicular offset off the course line produces opposite signed errors', () => {
    const st = { x: 0, y: 0 };
    const obs = 90;
    const ref = referenceRadialForCdi(obs, 'TO');
    const base = pointOnRadial(st, ref, 10);
    /** Course line is the ref radial through the station; offset locally north/south (not along the radial). */
    const δ = 0.85;
    const plusN = { x: base.x, y: base.y + δ };
    const minusN = { x: base.x, y: base.y - δ };
    const errP = vorCourseErrorDeg(radialFromStation(st, plusN), obs, 'TO');
    const errM = vorCourseErrorDeg(radialFromStation(st, minusN), obs, 'TO');
    expect(errP).not.toBe(0);
    expect(errM).not.toBe(0);
    expect(Math.sign(errP)).toBe(-Math.sign(errM));
    expect(Math.sign(errP)).toBe(Math.sign(cdiNeedleDeflection(errP)));
    expect(Math.sign(errM)).toBe(Math.sign(cdiNeedleDeflection(errM)));
  });
});

describe('distanceNm and stationPassage', () => {
  it('computes distance', () => {
    expect(distanceNm({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('detects passage', () => {
    expect(stationPassage(0.2, 0.35)).toBe(true);
    expect(stationPassage(0.5, 0.35)).toBe(false);
  });
});

describe('inConeOfConfusion and navSignalValid', () => {
  it('cone', () => {
    expect(inConeOfConfusion(0.3)).toBe(true);
    expect(inConeOfConfusion(2)).toBe(false);
  });
  it('nav range', () => {
    expect(navSignalValid(50)).toBe(true);
    expect(navSignalValid(0)).toBe(true);
    expect(navSignalValid(200)).toBe(false);
  });
});

describe('wind and ground track', () => {
  it('wind from 360 blows south', () => {
    const w = windComponentsFrom(360, 20);
    expect(w.north).toBeLessThan(0);
    expect(w.east).toBeCloseTo(0, 5);
  });
  it('headwind reduces ground speed', () => {
    const g = groundVelocityKts(360, 100, 360, 20);
    expect(g.groundSpeed).toBeLessThan(100);
  });
});

describe('recommendedInterceptHeading', () => {
  const st = { x: 0, y: 0 };

  it('0° lead returns established on-course heading (no fictitious intercept)', () => {
    const ac = { x: 12, y: -4 };
    const tgt = 90;
    expect(
      recommendedInterceptHeading({
        aircraft: ac,
        station: st,
        targetRadial: tgt,
        mode: 'OUTBOUND',
        interceptAngleDeg: 0,
        currentHeading: 200,
      }).heading
    ).toBe(onCourseHeading(tgt, 'OUTBOUND'));
    expect(
      recommendedInterceptHeading({
        aircraft: ac,
        station: st,
        targetRadial: tgt,
        mode: 'INBOUND',
        interceptAngleDeg: 0,
        currentHeading: 200,
      }).heading
    ).toBe(onCourseHeading(tgt, 'INBOUND'));
  });

  it('every cardinal target × mode × lateral side: intercept matches closed-form lead', () => {
    const lead = 38;
    const alongNm = 14;
    const crossNm = 6;
    const targets = [0, 90, 180, 270] as const;

    for (const tgt of targets) {
      for (const mode of ['OUTBOUND', 'INBOUND'] as const) {
        const rightPt = offsetPerpendicularAlongRadial(st, tgt, alongNm, crossNm);
        const leftPt = offsetPerpendicularAlongRadial(st, tgt, alongNm, -crossNm);

        expect(crossTrackSign(st, rightPt, tgt)).toBeGreaterThan(0);
        expect(crossTrackSign(st, leftPt, tgt)).toBeLessThan(0);

        const established = onCourseHeading(tgt, mode);
        const expectRight = normalizeHeading(established - lead);
        const expectLeft = normalizeHeading(established + lead);

        const gotRight = recommendedInterceptHeading({
          aircraft: rightPt,
          station: st,
          targetRadial: tgt,
          mode,
          interceptAngleDeg: lead,
          currentHeading: 0,
        }).heading;

        const gotLeft = recommendedInterceptHeading({
          aircraft: leftPt,
          station: st,
          targetRadial: tgt,
          mode,
          interceptAngleDeg: lead,
          currentHeading: 0,
        }).heading;

        expect(gotRight).toBe(expectRight);
        expect(gotLeft).toBe(expectLeft);
      }
    }
  });

  it('reports turn direction consistent with shortest path to intercept heading', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 8, y: -3 },
      station: st,
      targetRadial: 90,
      mode: 'OUTBOUND',
      interceptAngleDeg: 45,
      currentHeading: 10,
    });
    expect(r.turn).toBe(
      shortestSignedAngleDeg(10, r.heading) >= 0 ? 'RIGHT' : 'LEFT'
    );
    expect(r.currentRadial).toBe(radialFromStation(st, { x: 8, y: -3 }));
    expect(r.bearingToStation).toBe(bearingToStation(r.currentRadial));
  });

  it('OUTBOUND: south of east-west course subtracts lead (left turn toward course)', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: -5 },
      station: st,
      targetRadial: 90,
      mode: 'OUTBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(45, 5);
  });

  it('OUTBOUND: north of east-west course adds lead (right turn toward course)', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: 5 },
      station: st,
      targetRadial: 90,
      mode: 'OUTBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(135, 5);
  });

  it('INBOUND on R-090 from southeast subtracts lead toward reciprocal heading', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: -5 },
      station: st,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(225, 5);
  });

  it('INBOUND on R-090 from northwest adds lead toward reciprocal heading', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: 5 },
      station: st,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(315, 5);
  });
});

describe('cardinalRelativeToStation', () => {
  it('describes quadrants', () => {
    expect(
      cardinalRelativeToStation({ x: 0, y: 0 }, { x: 5, y: 1 })
    ).toMatch(/east/);
  });
});

describe('crossTrackSign', () => {
  it('separates left/right of radial line', () => {
    const st = { x: 0, y: 0 };
    expect(crossTrackSign(st, { x: 0, y: 5 }, 90)).not.toBe(0);
  });
});

describe('maxDistanceNmAlongRadialInExtents', () => {
  it('uses separate east vs north halves (narrow canvas)', () => {
    expect(maxDistanceNmAlongRadialInExtents(90, 10.2, 20)).toBeCloseTo(10.2, 10);
    expect(maxDistanceNmAlongRadialInExtents(0, 10.2, 20)).toBeCloseTo(20, 10);
    expect(maxDistanceNmAlongRadialInExtents(180, 10.2, 20)).toBeCloseTo(20, 10);
  });
});

describe('clampAircraftPositionToStationExtents', () => {
  const st = { x: 0, y: 0 };
  it('pins out-of-range east/north', () => {
    const p = { x: 50, y: -3 };
    const c = clampAircraftPositionToStationExtents(st, p, 12, 8);
    expect(c.x).toBe(12);
    expect(c.y).toBe(-3);
    const q = { x: 1, y: -90 };
    const c2 = clampAircraftPositionToStationExtents(st, q, 12, 8);
    expect(c2.y).toBe(-8);
  });
});

describe('maxDistanceNmAlongRadialInPlanView', () => {
  const H = MAP_PLAN_VIEW_HALF_NM - MAP_PLAN_DME_MARGIN_NM;

  it('cardinals are limited by half-span', () => {
    expect(maxDistanceNmAlongRadialInPlanView(0, H)).toBeCloseTo(H, 10);
    expect(maxDistanceNmAlongRadialInPlanView(90, H)).toBeCloseTo(H, 10);
    expect(maxDistanceNmAlongRadialInPlanView(180, H)).toBeCloseTo(H, 10);
    expect(maxDistanceNmAlongRadialInPlanView(270, H)).toBeCloseTo(H, 10);
  });

  it('diagonal allows farther DME before leaving the axis-aligned square', () => {
    const d45 = maxDistanceNmAlongRadialInPlanView(45, H);
    expect(d45).toBeCloseTo(H * Math.SQRT2, 10);
  });

  it('computed point stays inside the square', () => {
    const d = maxDistanceNmAlongRadialInPlanView(37);
    const r = (37 * Math.PI) / 180;
    expect(Math.abs(Math.sin(r) * d)).toBeLessThanOrEqual(H + 1e-9);
    expect(Math.abs(Math.cos(r) * d)).toBeLessThanOrEqual(H + 1e-9);
  });
});

// --- helpers ---
const ORIGIN = { x: 0, y: 0 };

/** Point `nmOut` NM from station along radial FROM station TO aircraft bearing `radialDeg`. */
function pointOnRadial(
  station: typeof ORIGIN,
  radialDeg: number,
  nmOut: number
): { x: number; y: number } {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  return {
    x: station.x + Math.sin(θ) * nmOut,
    y: station.y + Math.cos(θ) * nmOut,
  };
}

/**
 * Start `alongNm` out on `radialDeg`, then move `crossNm` perpendicular to that outbound ray
 * (positive cross = {@link crossTrackSign} positive = “right” of the course).
 */
function offsetPerpendicularAlongRadial(
  station: typeof ORIGIN,
  radialDeg: number,
  alongNm: number,
  crossNm: number
): { x: number; y: number } {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  const bx = station.x + Math.sin(θ) * alongNm;
  const by = station.y + Math.cos(θ) * alongNm;
  return {
    x: bx + Math.cos(θ) * crossNm,
    y: by - Math.sin(θ) * crossNm,
  };
}
