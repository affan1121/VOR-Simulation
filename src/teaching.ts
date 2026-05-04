import type { SimSnapshot } from './hooks/useSimulation';
import {
  cardinalRelativeToStation,
  crossTrackSign,
  formatMagneticThreeDigit360,
  reciprocalCourse,
  shortestSignedAngleDeg,
} from './utils/vorMath';
import type { Position } from './types';

const STATION: Position = { x: 0, y: 0 };

/**
 * Plain-English explanation of current needle, flags, and map sense for training panel.
 */
export function buildTeachingNarrative(s: SimSnapshot): string[] {
  const lines: string[] = [];
  const obs = Math.round(s.obs);
  const rad = Math.round(s.radial);
  const crsInbound = reciprocalCourse(s.obs);

  lines.push(
    `OBS is set to ${obs.toString().padStart(3, '0')}°. That selects the ${obs.toString().padStart(3, '0')}° course line through the station (outbound along ${obs.toString().padStart(3, '0')}°, inbound along ${Math.round(crsInbound).toString().padStart(3, '0')}° toward the VOR).`
  );

  lines.push(
    `You are on the ${rad.toString().padStart(3, '0')}° radial — the magnetic bearing **from** the station **to** your aircraft. Bearing **to** the station is the reciprocal: ${Math.round(s.bearingToStation).toString().padStart(3, '0')}°.`
  );

  const card = cardinalRelativeToStation(STATION, s.aircraft);
  lines.push(`Relative to the station you are ${card} (flat-earth training plot).`);

  if (!s.navValid) {
    lines.push('NAV flag: simulated loss of usable signal at extreme range.');
    return lines;
  }

  lines.push(
    `TO/FROM: With this OBS setting you are on the **${s.toFrom}** side — the selected course generally leads ${s.toFrom === 'TO' ? 'toward' : 'away from'} the station from where you sit.`
  );

  const side = crossTrackSign(STATION, s.aircraft, s.obs);
  const sideTxt =
    Math.abs(side) < 0.01
      ? 'on the OBS course line'
      : side > 0
        ? 'to the **right** of the OBS course line (looking outbound along OBS from the station)'
        : 'to the **left** of the OBS course line';
  lines.push(`Laterally you are ${sideTxt}.`);

  const needle =
    Math.abs(s.cdi) < 0.03
      ? 'centered — you are on the selected course for this TO/FROM sense.'
      : s.cdi > 0
        ? `deflected **right** — fly **toward the needle** (turn **right**) to cancel about ${Math.abs(s.courseErrorDeg).toFixed(1)}° of course error (full scale ≈ 10°).`
        : `deflected **left** — fly **toward the needle** (turn **left**) to cancel about ${Math.abs(s.courseErrorDeg).toFixed(1)}° of course error.`;
  lines.push(`CDI is ${needle}`);

  if (s.inCone) {
    lines.push(
      'Near the station the signal becomes unreliable (cone of confusion): expect TO/FROM ambiguity and needle jitter — same behavior as light trainers emphasize.'
    );
  }

  return lines;
}

export function explainCdiLeftRight(s: SimSnapshot): string {
  if (Math.abs(s.cdi) < 0.05) return 'CDI centered — no turn required for course.';
  const errAbs = Math.abs(s.courseErrorDeg);
  if (s.cdi > 0)
    return `CDI deflected **right** — fly **right** toward the needle (${errAbs.toFixed(1)}° off selected course).`;
  return `CDI deflected **left** — fly **left** toward the needle (${errAbs.toFixed(1)}° off selected course).`;
}

export function explainInterceptTurn(
  currentHdg: number,
  recommendedHdg: number
): string {
  const t = shortestSignedAngleDeg(currentHdg, recommendedHdg);
  if (Math.abs(t) < 3) return 'Your heading already matches the recommended intercept heading within a few degrees.';
  return `Recommended intercept heading is ${formatMagneticThreeDigit360(recommendedHdg)}° — turn **${t >= 0 ? 'right' : 'left'}** about ${Math.abs(Math.round(t))}° to establish.`;
}
