import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bearingToStation,
  cdiNeedleDeflection,
  DME_EDIT_MAX_NM,
  DME_EDIT_MIN_NM,
  distanceNm,
  groundVelocityKts,
  inConeOfConfusion,
  navSignalValid,
  normalizeHeading,
  radialFromStation,
  VOR_CDI_FULL_SCALE_DEG,
  vorCourseErrorDeg,
  vorToFrom,
} from '../utils/vorMath';
import type { Position } from '../types';

const STATION: Position = { x: 0, y: 0 };
export const PASSAGE_THRESHOLD_NM = 0.35;
export const CONE_NM = 0.65;
const TRAIL_MAX = 900;
const TICK_MS = 1000 / 30;

export interface SimSnapshot {
  aircraft: Position;
  heading: number;
  airspeed: number;
  windFrom: number;
  windSpeed: number;
  obs: number;
  radial: number;
  bearingToStation: number;
  dmeNm: number;
  toFrom: 'TO' | 'FROM';
  toFromRaw: ReturnType<typeof vorToFrom>;
  courseErrorDeg: number;
  cdi: number;
  navValid: boolean;
  /** TO/FROM flags usable (blanked over station like a real VOR). */
  vorFlagsValid: boolean;
  inCone: boolean;
  passageMessageActive: boolean;
  track: number;
  groundSpeed: number;
}

function applyConeNoise(
  baseCdi: number,
  distanceNmVal: number,
  timeSec: number
): number {
  if (!inConeOfConfusion(distanceNmVal, CONE_NM)) return baseCdi;
  const depth = 1 - distanceNmVal / CONE_NM;
  const wobble =
    Math.sin(timeSec * 14) * 0.38 * depth +
    Math.sin(timeSec * 31) * 0.18 * depth;
  return Math.max(-1, Math.min(1, baseCdi + wobble));
}

export function useSimulation() {
  const [aircraft, setAircraft] = useState<Position>({ x: 0, y: 8 });
  const [heading, setHeading] = useState(180);
  const [airspeed, setAirspeed] = useState(120);
  const [windFrom, setWindFrom] = useState(360);
  const [windSpeed, setWindSpeed] = useState(0);
  const [obs, setObs] = useState(360);
  const [paused, setPaused] = useState(false);
  const [simTime, setSimTime] = useState(0);
  const passageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [passageBanner, setPassageBanner] = useState(false);

  const trailRef = useRef<Position[]>([]);
  const passageInsideRef = useRef(false);
  const oscillationPhaseRef = useRef(0);
  const simTimeRef = useRef(0);

  /** When true, aircraft moves at `directGroundSpeed` along heading (no wind vector). */
  const [directGroundSpeedMode, setDirectGroundSpeedMode] = useState(false);
  const [directGroundSpeed, setDirectGroundSpeed] = useState(120);

  /** Latest flight controls — read inside the interval so we don’t restart the timer every slider move. */
  const headingRef = useRef(heading);
  const airspeedRef = useRef(airspeed);
  const windFromRef = useRef(windFrom);
  const windSpeedRef = useRef(windSpeed);
  const directGsModeRef = useRef(false);
  const directGsRef = useRef(120);
  const draggingAircraftRef = useRef(false);

  useEffect(() => {
    headingRef.current = heading;
    airspeedRef.current = airspeed;
    windFromRef.current = windFrom;
    windSpeedRef.current = windSpeed;
    directGsModeRef.current = directGroundSpeedMode;
    directGsRef.current = directGroundSpeed;
  });

  const resetTrail = useCallback(() => {
    trailRef.current = [];
  }, []);

  const setAircraftDragging = useCallback((dragging: boolean) => {
    draggingAircraftRef.current = dragging;
  }, []);

  const moveAircraftTo = useCallback((p: Position) => {
    const next = { x: p.x, y: p.y };
    setAircraft(next);
    trailRef.current = [{ ...next }];
  }, []);

  /** Sets slant-range DME by moving the aircraft along the current radial (bearing from station). */
  const setDistanceFromStation = useCallback((nm: number) => {
    const d = Math.max(
      DME_EDIT_MIN_NM,
      Math.min(DME_EDIT_MAX_NM, Number(nm))
    );
    setAircraft((prev) => {
      const radialDeg = radialFromStation(STATION, prev);
      const rad = (radialDeg * Math.PI) / 180;
      const east = Math.sin(rad) * d;
      const north = Math.cos(rad) * d;
      const next = { x: STATION.x + east, y: STATION.y + north };
      trailRef.current = [{ ...next }];
      return next;
    });
  }, []);

  const loadInitial = useCallback(
    (p: {
      aircraft: Position;
      heading: number;
      airspeed: number;
      obs: number;
      windFrom: number;
      windSpeed: number;
    }) => {
      setAircraft({ ...p.aircraft });
      setHeading(normalizeHeading(p.heading));
      setAirspeed(p.airspeed);
      setObs(normalizeHeading(p.obs));
      setWindFrom(normalizeHeading(p.windFrom));
      setWindSpeed(p.windSpeed);
      headingRef.current = normalizeHeading(p.heading);
      airspeedRef.current = p.airspeed;
      windFromRef.current = normalizeHeading(p.windFrom);
      windSpeedRef.current = p.windSpeed;
      if (passageTimeoutRef.current) clearTimeout(passageTimeoutRef.current);
      passageTimeoutRef.current = null;
      setPassageBanner(false);
      simTimeRef.current = 0;
      setSimTime(0);
      passageInsideRef.current = false;
      oscillationPhaseRef.current = 0;
      trailRef.current = [{ ...p.aircraft }];
    },
    []
  );

  const reset = useCallback(() => {
    setDirectGroundSpeedMode(false);
    setDirectGroundSpeed(120);
    directGsModeRef.current = false;
    directGsRef.current = 120;
    loadInitial({
      aircraft: { x: 0, y: 8 },
      heading: 180,
      airspeed: 120,
      obs: 360,
      windFrom: 360,
      windSpeed: 0,
    });
  }, [loadInitial]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const nextT = simTimeRef.current + TICK_MS / 1000;
      simTimeRef.current = nextT;
      setSimTime(nextT);
      setAircraft((prev) => {
        if (draggingAircraftRef.current) return prev;
        const dtHr = TICK_MS / 3_600_000;
        let east: number;
        let north: number;
        if (directGsModeRef.current) {
          const h = (headingRef.current * Math.PI) / 180;
          const gs = directGsRef.current;
          east = Math.sin(h) * gs;
          north = Math.cos(h) * gs;
        } else {
          const gv = groundVelocityKts(
            headingRef.current,
            airspeedRef.current,
            windFromRef.current,
            windSpeedRef.current
          );
          east = gv.east;
          north = gv.north;
        }
        const next = {
          x: prev.x + east * dtHr,
          y: prev.y + north * dtHr,
        };
        const dist = distanceNm(STATION, next);
        if (stationPassageEdge(dist, passageInsideRef)) {
          setPassageBanner(true);
          if (passageTimeoutRef.current) clearTimeout(passageTimeoutRef.current);
          passageTimeoutRef.current = setTimeout(() => {
            setPassageBanner(false);
            passageTimeoutRef.current = null;
          }, 4000);
        }
        if (inConeOfConfusion(dist, CONE_NM)) {
          oscillationPhaseRef.current += 0.2;
        }
        const tr = trailRef.current;
        tr.push({ ...next });
        if (tr.length > TRAIL_MAX) tr.shift();
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  const snapshot: SimSnapshot = useMemo(() => {
    const dist = distanceNm(STATION, aircraft);
    const radial = radialFromStation(STATION, aircraft);
    const brgTo = bearingToStation(radial);
    const ambCos =
      dist < CONE_NM
        ? 0.12 + Math.sin(simTime * 22) * 0.08
        : 0.05;
    const rawTf = vorToFrom(radial, obs, ambCos);

    let toFrom: 'TO' | 'FROM' =
      rawTf === 'AMBIGUOUS'
        ? Math.sin(oscillationPhaseRef.current) >= 0
          ? 'TO'
          : 'FROM'
        : rawTf;

    if (dist < CONE_NM) {
      const flip = Math.sin(oscillationPhaseRef.current * 3) > 0;
      toFrom = flip ? 'TO' : 'FROM';
    }

    const courseErrorDeg = vorCourseErrorDeg(radial, obs, toFrom);
    /** Raw ±10° scale then negate so gauge matches FAA sense: fly toward the needle (needle right ⇒ fly right). */
    let cdi = -cdiNeedleDeflection(courseErrorDeg, VOR_CDI_FULL_SCALE_DEG);
    cdi = applyConeNoise(cdi, dist, simTime);

    const gv = directGroundSpeedMode
      ? {
          track: normalizeHeading(heading),
          groundSpeed: directGroundSpeed,
        }
      : groundVelocityKts(heading, airspeed, windFrom, windSpeed);

    const signalOk = navSignalValid(dist);
    const vorFlagsValid = signalOk && dist >= PASSAGE_THRESHOLD_NM;

    return {
      aircraft: { ...aircraft },
      heading: normalizeHeading(heading),
      airspeed,
      windFrom: normalizeHeading(windFrom),
      windSpeed,
      obs: normalizeHeading(obs),
      radial,
      bearingToStation: brgTo,
      dmeNm: dist,
      toFrom,
      toFromRaw: rawTf,
      courseErrorDeg,
      cdi,
      navValid: signalOk,
      vorFlagsValid,
      inCone: inConeOfConfusion(dist, CONE_NM),
      passageMessageActive: passageBanner,
      track: gv.track,
      groundSpeed: gv.groundSpeed,
    };
  }, [
    aircraft,
    heading,
    airspeed,
    windFrom,
    windSpeed,
    obs,
    simTime,
    passageBanner,
    directGroundSpeedMode,
    directGroundSpeed,
  ]);

  useEffect(() => {
    return () => {
      if (passageTimeoutRef.current) clearTimeout(passageTimeoutRef.current);
    };
  }, []);

  return {
    aircraft,
    heading,
    setHeading,
    airspeed,
    setAirspeed,
    windFrom,
    setWindFrom,
    windSpeed,
    setWindSpeed,
    directGroundSpeedMode,
    setDirectGroundSpeedMode,
    directGroundSpeed,
    setDirectGroundSpeed,
    obs,
    setObs,
    paused,
    setPaused,
    station: STATION,
    reset,
    loadInitial,
    trailRef,
    resetTrail,
    snapshot,
    passageThresholdNm: PASSAGE_THRESHOLD_NM,
    coneNm: CONE_NM,
    moveAircraftTo,
    setDistanceFromStation,
    setAircraftDragging,
  };
}

function stationPassageEdge(
  dist: number,
  insideRef: { current: boolean }
): boolean {
  const inside = dist < PASSAGE_THRESHOLD_NM;
  const crossed = inside && !insideRef.current;
  insideRef.current = inside;
  return crossed;
}

