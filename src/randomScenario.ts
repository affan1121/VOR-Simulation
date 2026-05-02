import { normalizeHeading, reciprocalCourse, radialFromStation } from './utils/vorMath';
import type { Position } from './types';

const STATION: Position = { x: 0, y: 0 };

export interface RandomChallenge {
  title: string;
  initial: {
    aircraft: Position;
    heading: number;
    airspeed: number;
    obs: number;
    windFrom: number;
    windSpeed: number;
  };
  goalRadial: number;
  goalMode: 'INBOUND' | 'OUTBOUND';
  explanation: string;
}

/** Simple pseudo-random scenario with printed answer for self-check. */
export function generateRandomChallenge(): RandomChallenge {
  const target = normalizeHeading(Math.floor(Math.random() * 360));
  const bearingFromStation = normalizeHeading(Math.random() * 360);
  const distNm = 6 + Math.random() * 10;
  const θ = (bearingFromStation * Math.PI) / 180;
  const aircraft: Position = {
    x: STATION.x + distNm * Math.sin(θ),
    y: STATION.y + distNm * Math.cos(θ),
  };
  const heading = normalizeHeading(Math.random() * 360);
  const obs = normalizeHeading(target + (Math.random() > 0.5 ? 0 : 180));
  const windFrom = normalizeHeading(Math.floor(Math.random() * 12) * 30);
  const windSpeed = Math.floor(Math.random() * 25);
  const airspeed = 100 + Math.floor(Math.random() * 40);
  const inbound = Math.random() > 0.5;
  const mode: 'INBOUND' | 'OUTBOUND' = inbound ? 'INBOUND' : 'OUTBOUND';

  const actualRadial = Math.round(radialFromStation(STATION, aircraft));
  const inboundCrs = reciprocalCourse(target);

  const explanation = [
    `Your aircraft reads about the **${actualRadial}°** radial at this instant.`,
    mode === 'INBOUND'
      ? `For an **inbound** intercept on the **${target}°** radial, you eventually want to fly heading **${Math.round(inboundCrs)}°** toward the station once established on that radial (reciprocal of the radial).`
      : `For **outbound** tracking on the **${target}°** radial, established heading is **${target}°** away from the station.`,
    `Use the intercept planner with target radial ${target}° and mode ${mode}. Wind is from ${windFrom}° at ${windSpeed} kt — remember ground track ≠ heading.`,
  ].join(' ');

  return {
    title: `Random #${Math.round(target)} / ${mode}`,
    initial: { aircraft, heading, airspeed, obs, windFrom, windSpeed },
    goalRadial: target,
    goalMode: mode,
    explanation,
  };
}
