import { describe, expect, it } from 'vitest';
import {
  bearingToStation,
  cardinalRelativeToStation,
  cdiNeedleDeflection,
  crossTrackSign,
  vorCdiNeedleFromCourseError,
  crossTrackSignRate,
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
  vorToFromGeometry,
  windComponentsFrom,
  MAP_PLAN_VIEW_HALF_NM,
  MAP_PLAN_DME_MARGIN_NM,
  maxDistanceNmAlongRadialInPlanView,
  maxDistanceNmAlongRadialInExtents,
  clampAircraftPositionToStationExtents,
  INTERCEPT_LEAD_ANGLE_MAX_DEG,
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

describe('vorToFromGeometry (CDI — no ambiguity band)', () => {
  it('matches vorToFrom with no threshold except abeam is TO (not AMBIGUOUS)', () => {
    expect(vorToFromGeometry(360, 360)).toBe('FROM');
    expect(vorToFromGeometry(180, 360)).toBe('TO');
    expect(vorToFromGeometry(90, 0)).toBe('TO');
    expect(vorToFromGeometry(270, 0)).toBe('TO');
  });

  it('CDI course error always uses this hemisphere (stable vs wrong toFrom)', () => {
    const r = 155;
    const obs = 360;
    const g = vorToFromGeometry(r, obs);
    expect(vorCourseErrorDeg(r, obs, g)).toBe(
      vorCourseErrorDeg(r, obs, g === 'TO' ? 'TO' : 'FROM')
    );
    expect(vorCourseErrorDeg(r, obs, g)).not.toBe(vorCourseErrorDeg(r, obs, g === 'TO' ? 'FROM' : 'TO'));
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
  it('10° course error: raw mapping vs cockpit needle (fly toward needle)', () => {
    const e = vorCourseErrorDeg(10, 0, 'FROM');
    expect(e).toBeCloseTo(10, 5);
    expect(cdiNeedleDeflection(e, VOR_CDI_FULL_SCALE_DEG)).toBe(1);
    expect(vorCdiNeedleFromCourseError(e, VOR_CDI_FULL_SCALE_DEG)).toBe(-1);
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

  it('course error matches signed shortest arc (FROM: ref→radial, TO: radial→ref)', () => {
    for (const obs of [0, 45, 90, 200]) {
      for (const tf of ['FROM', 'TO'] as const) {
        const ref = referenceRadialForCdi(obs, tf);
        for (const off of [-9, -3, 3, 9]) {
          const r = normalizeHeading(ref + off);
          const expected =
            tf === 'FROM'
              ? shortestSignedAngleDeg(ref, r)
              : shortestSignedAngleDeg(r, ref);
          expect(vorCourseErrorDeg(r, obs, tf)).toBe(expected);
        }
      }
    }
  });

  it('OBS 360 TO on R-155: east of inbound course ⇒ needle left', () => {
    expect(vorToFrom(155, 360)).toBe('TO');
    const err = vorCourseErrorDeg(155, 360, 'TO');
    expect(err).toBeCloseTo(25, 5);
    expect(vorCdiNeedleFromCourseError(err)).toBeLessThan(0);
  });

  /**
   * AIM-style VOT centering: with CDI centered, OBS 000 + FROM (on R-000) or OBS 180 + TO (on R-180).
   * See `docs/VOR_ACCURACY.md` for references.
   */
  it('AIM VOT-style: centered on R-000 with OBS 0 FROM, and on R-180 with OBS 0 TO', () => {
    expect(vorCourseErrorDeg(0, 0, 'FROM')).toBe(0);
    expect(vorCdiNeedleFromCourseError(vorCourseErrorDeg(0, 0, 'FROM'))).toBeCloseTo(0, 15);
    expect(vorCourseErrorDeg(180, 0, 'TO')).toBe(0);
    expect(vorCdiNeedleFromCourseError(vorCourseErrorDeg(180, 0, 'TO'))).toBeCloseTo(0, 15);
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

  it('raw cdiNeedleDeflection keeps same sign as signed course error', () => {
    const pairs: [number, number][] = [
      [4, 0.4],
      [-6, -0.6],
    ];
    for (const [err, needle] of pairs) {
      expect(cdiNeedleDeflection(err)).toBeCloseTo(needle, 10);
      expect(Math.sign(cdiNeedleDeflection(err))).toBe(Math.sign(err));
    }
  });

  it('cockpit needle points toward course (opposite sign from raw linear error)', () => {
    expect(vorCdiNeedleFromCourseError(5)).toBeCloseTo(-0.5, 10);
    expect(Math.sign(vorCdiNeedleFromCourseError(4))).toBe(-1);
    expect(Math.sign(vorCdiNeedleFromCourseError(-6))).toBe(1);
  });

  it('FROM: right of OBS line ⇒ positive course error ⇒ cockpit needle left (fly left)', () => {
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
    expect(vorCdiNeedleFromCourseError(vorCourseErrorDeg(rR, obs, 'FROM'))).toBeLessThan(0);
    expect(vorCdiNeedleFromCourseError(vorCourseErrorDeg(rL, obs, 'FROM'))).toBeGreaterThan(0);
  });

  it('OBS 360 FROM on R-330: needle deflects right (course is to the right)', () => {
    const err = vorCourseErrorDeg(330, 360, 'FROM');
    expect(err).toBeCloseTo(-30, 5);
    expect(vorCdiNeedleFromCourseError(err)).toBeGreaterThan(0);
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
    expect(Math.sign(errP)).toBe(-Math.sign(vorCdiNeedleFromCourseError(errP)));
    expect(Math.sign(errM)).toBe(-Math.sign(vorCdiNeedleFromCourseError(errM)));
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

  /** Shared invariant for grid tests — fails with a diagnostic context line on mismatch. */
  function assertInterceptTowardLine(
    ac: { x: number; y: number },
    tgt: number,
    mode: 'INBOUND' | 'OUTBOUND',
    lead: number,
    label = ''
  ): void {
    const got = recommendedInterceptHeading({
      aircraft: ac,
      station: st,
      targetRadial: tgt,
      mode,
      interceptAngleDeg: lead,
      currentHeading: 0,
    }).heading;
    const established = onCourseHeading(tgt, mode);
    const candA = normalizeHeading(established - lead);
    const candB = normalizeHeading(established + lead);
    if (![candA, candB].includes(got)) {
      throw new Error(`${label}: expected ${candA}° or ${candB}°, got ${got}°`);
    }
    const c0 = crossTrackSign(st, ac, tgt);
    const rate = crossTrackSignRate(st, ac, tgt, got);
    if (Math.abs(c0) > 1e-3 && rate * c0 >= 0) {
      throw new Error(
        `${label}: cross-track not closing (c0=${c0}, rate=${rate}, got=${got})`
      );
    }
  }

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

  it('every cardinal target × mode: intercept is ±lead from on-course and cuts toward the line', () => {
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
        const candA = normalizeHeading(established - lead);
        const candB = normalizeHeading(established + lead);

        for (const pt of [rightPt, leftPt]) {
          const got = recommendedInterceptHeading({
            aircraft: pt,
            station: st,
            targetRadial: tgt,
            mode,
            interceptAngleDeg: lead,
            currentHeading: 0,
          }).heading;
          expect([candA, candB]).toContain(got);
          const c0 = crossTrackSign(st, pt, tgt);
          const rate = crossTrackSignRate(st, pt, tgt, got);
          if (Math.abs(c0) > 1e-4) {
            expect(rate * c0).toBeLessThan(0);
          }
        }
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

  it('INBOUND on R-090 from southeast: picks heading toward course (315°), not away (225°)', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: -5 },
      station: st,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(315, 5);
  });

  it('INBOUND on R-090 from northwest: picks heading toward course (225°), not away (315°)', () => {
    const r = recommendedInterceptHeading({
      aircraft: { x: 10, y: 5 },
      station: st,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 45,
      currentHeading: 180,
    });
    expect(r.heading).toBeCloseTo(225, 5);
  });

  it('INBOUND R-090 with 90° lead from 210° radial: north (0° ≡ 360°), not 180° away', () => {
    const nm = 10;
    const θ = (210 * Math.PI) / 180;
    const ac = { x: Math.sin(θ) * nm, y: Math.cos(θ) * nm };
    const r = recommendedInterceptHeading({
      aircraft: ac,
      station: st,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 90,
      currentHeading: 180,
    });
    expect(r.heading).toBe(0);
  });

  /**
   * Full combinatorial sweep: every intercept angle degree (1–MAX), every magnetic target radial,
   * every aircraft direction around the VOR at fixed DME — both inbound and outbound join modes.
   * (~23.3M cases; validates ±lead membership + cross-track closes toward the extended course.)
   */
  it(
    'exhaustive grid: every lead ° × every target radial ° × every AC bearing ° @ 10 NM',
    { timeout: 300_000 },
    () => {
      const dmeNm = 10;
      for (let lead = 1; lead <= INTERCEPT_LEAD_ANGLE_MAX_DEG; lead++) {
        for (let tgt = 0; tgt < 360; tgt++) {
          for (let acBrg = 0; acBrg < 360; acBrg++) {
            const θ = (acBrg * Math.PI) / 180;
            const ac = { x: Math.sin(θ) * dmeNm, y: Math.cos(θ) * dmeNm };
            const ctx = `lead=${lead} tgt=${tgt} acBrg=${acBrg}`;
            assertInterceptTowardLine(ac, tgt, 'OUTBOUND', lead, ctx);
            assertInterceptTowardLine(ac, tgt, 'INBOUND', lead, ctx);
          }
        }
      }
    }
  );

  it('intercept magnetic heading does not depend on currentHeading (only turn hint does)', () => {
    const ac = { x: -6.2, y: -9.1 };
    const base = recommendedInterceptHeading({
      aircraft: ac,
      station: st,
      targetRadial: 117,
      mode: 'INBOUND',
      interceptAngleDeg: 52,
      currentHeading: 0,
    }).heading;
    for (let ch = 1; ch < 360; ch++) {
      expect(
        recommendedInterceptHeading({
          aircraft: ac,
          station: st,
          targetRadial: 117,
          mode: 'INBOUND',
          interceptAngleDeg: 52,
          currentHeading: ch,
        }).heading
      ).toBe(base);
    }
  });

  it('extra DME distances: sparse grid covers remaining NM cases', () => {
    for (const dmeNm of [2.5, 3, 8, 25, 40, 55]) {
      for (const lead of [1, 15, 44, 61, 89, 90]) {
        for (let tgt = 0; tgt < 360; tgt += 5) {
          for (let acBrg = 0; acBrg < 360; acBrg += 5) {
            const θ = (acBrg * Math.PI) / 180;
            const ac = { x: Math.sin(θ) * dmeNm, y: Math.cos(θ) * dmeNm };
            const ctx = `dme=${dmeNm} lead=${lead} tgt=${tgt} acBrg=${acBrg}`;
            assertInterceptTowardLine(ac, tgt, 'OUTBOUND', lead, ctx);
            assertInterceptTowardLine(ac, tgt, 'INBOUND', lead, ctx);
          }
        }
      }
    }
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
