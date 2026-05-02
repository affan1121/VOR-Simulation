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
  radialFromStation,
  reciprocalCourse,
  recommendedInterceptHeading,
  referenceRadialForCdi,
  shortestSignedAngleDeg,
  stationPassage,
  VOR_CDI_FULL_SCALE_DEG,
  vorCourseErrorDeg,
  vorToFrom,
  windComponentsFrom,
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
  it('FROM when on outbound side of OBS', () => {
    expect(vorToFrom(360, 360, 0)).toBe('FROM');
    expect(vorToFrom(90, 90, 0)).toBe('FROM');
  });
  it('TO when on inbound side', () => {
    expect(vorToFrom(180, 360, 0)).toBe('TO');
    expect(vorToFrom(270, 90, 0)).toBe('TO');
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
});

describe('cdiNeedleDeflection', () => {
  it('clamps to ±1', () => {
    expect(cdiNeedleDeflection(15, VOR_CDI_FULL_SCALE_DEG)).toBe(1);
    expect(cdiNeedleDeflection(-20, VOR_CDI_FULL_SCALE_DEG)).toBe(-1);
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
