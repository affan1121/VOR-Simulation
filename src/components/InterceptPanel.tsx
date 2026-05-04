import type { InterceptMode } from '../utils/vorMath';
import {
  INTERCEPT_LEAD_ANGLE_MAX_DEG,
  formatMagneticThreeDigit360,
  normalizeHeading,
  reciprocalCourse,
  recommendedInterceptHeading,
} from '../utils/vorMath';
import type { Position } from '../types';
import { explainInterceptTurn } from '../teaching';
import type { SimSnapshot } from '../hooks/useSimulation';

type Props = {
  station: Position;
  snapshot: SimSnapshot;
  targetRadial: number;
  onTargetRadial: (r: number) => void;
  mode: InterceptMode;
  onMode: (m: InterceptMode) => void;
  interceptAngle: number;
  onInterceptAngle: (a: number) => void;
  /** False when lead &gt; 0 but the map overlay is hidden (e.g. established on target radial). */
  interceptOverlayOnMap: boolean;
};

export function InterceptPanel({
  station,
  snapshot,
  targetRadial,
  onTargetRadial,
  mode,
  onMode,
  interceptAngle,
  onInterceptAngle,
  interceptOverlayOnMap,
}: Props) {
  const rec = recommendedInterceptHeading({
    aircraft: snapshot.aircraft,
    station,
    targetRadial,
    mode,
    interceptAngleDeg: interceptAngle,
    currentHeading: snapshot.heading,
  });

  const tgtNorm = normalizeHeading(targetRadial);
  const tgtDigits =
    tgtNorm === 0 ? '360' : Math.round(tgtNorm).toString().padStart(3, '0');
  const interceptHdg = formatMagneticThreeDigit360(rec.heading);
  const establishedHdg = formatMagneticThreeDigit360(
    mode === 'INBOUND' ? reciprocalCourse(tgtNorm) : tgtNorm
  );
  const currentHdg = Math.round(snapshot.heading);

  return (
    <div className="card intercept-card">
      <h3>Intercept</h3>
      <p className="hint">
        Pick the radial you want to join and inbound vs outbound. Set the intercept angle (lead); use{' '}
        <strong>0°</strong> to hide intercept lines completely. With angle &gt; 0°, lines appear until you are established on
        the target radial, then the map clears them automatically.
      </p>
      <ol className="intercept-steps">
        <li>
          <strong>When angle &gt; 0° — purple through the VOR:</strong> target radial (<code>TGT R-###°</code>).
        </li>
        <li>
          <strong>When angle &gt; 0° — bright purple through the airplane:</strong> intercept heading (
          <code>INT ###°</code> + lead).
        </li>
        <li>
          Turn to that intercept heading and hold it until the CDI centers — you are then established on the target
          radial (match OBS to that radial to confirm).
        </li>
      </ol>

      <label className="ctl">
        <span>Radial (°)</span>
        <input
          type="number"
          min={0}
          max={359}
          value={Math.round(targetRadial)}
          onChange={(e) => onTargetRadial(Number(e.target.value) % 360)}
          className="num wide"
        />
      </label>

      <div className="seg">
        <button
          type="button"
          className={`btn ${mode === 'INBOUND' ? 'primary' : ''}`}
          onClick={() => onMode('INBOUND')}
        >
          Inbound TO station
        </button>
        <button
          type="button"
          className={`btn ${mode === 'OUTBOUND' ? 'primary' : ''}`}
          onClick={() => onMode('OUTBOUND')}
        >
          Outbound FROM station
        </button>
      </div>

      <label className="ctl">
        <span title="Lead angle for intercept">Intercept angle (°)</span>
        <input
          type="range"
          min={0}
          max={INTERCEPT_LEAD_ANGLE_MAX_DEG}
          value={interceptAngle}
          onChange={(e) => onInterceptAngle(Number(e.target.value))}
        />
        <input
          type="number"
          min={0}
          max={INTERCEPT_LEAD_ANGLE_MAX_DEG}
          value={interceptAngle}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onInterceptAngle(
              Math.max(0, Math.min(INTERCEPT_LEAD_ANGLE_MAX_DEG, Math.round(v)))
            );
          }}
          className="num wide"
          aria-label="Intercept angle degrees"
        />
      </label>

      {interceptAngle > 0 && interceptOverlayOnMap ? (
        <div className="intercept-heading-answer" role="status">
          <p className="intercept-heading-lead">
            To intercept <strong>R-{tgtDigits}°</strong>{' '}
            {mode === 'INBOUND'
              ? '(inbound — toward the station on that radial)'
              : '(outbound — away from the station on that radial)'}{' '}
            with your <strong>{interceptAngle}°</strong> intercept angle, fly heading{' '}
            <strong className="intercept-hdg-num">{interceptHdg}°</strong> magnetic until the CDI centers.
          </p>
          <p className="intercept-heading-sub">
            From heading <strong>{currentHdg}°</strong>, turn <strong>{rec.turn}</strong> to establish{' '}
            {interceptHdg}°. After you&apos;re on course, fly <strong>{establishedHdg}°</strong> to{' '}
            {mode === 'INBOUND' ? 'stay inbound on R-' + tgtDigits + '°' : 'stay outbound on R-' + tgtDigits + '°'}.
          </p>
          <p className="intercept-heading-turn fine">{explainInterceptTurn(snapshot.heading, rec.heading)}</p>
          <p className="intercept-wind-note">
            Wind changes your ground <strong>track</strong> versus heading — use the map and CDI together, not heading
            alone, to judge when you&apos;ve captured the radial.
          </p>
        </div>
      ) : null}
      {interceptAngle > 0 && !interceptOverlayOnMap ? (
        <p className="intercept-established-note fine" role="status">
          Established{' '}
          {mode === 'OUTBOUND' ? (
            <>
              <strong>outbound</strong> on <strong>R-{tgtDigits}°</strong>
            </>
          ) : (
            <>
              <strong>inbound</strong> on that radial — your R-### matches the{' '}
              <strong>reciprocal</strong> ({formatMagneticThreeDigit360(reciprocalCourse(tgtNorm))}°)
            </>
          )}{' '}
          (within a few degrees). Intercept lines are off the map until you drift away. Set intercept angle to{' '}
          <strong>0°</strong> to hide help entirely.
        </p>
      ) : null}
      {interceptAngle <= 0 ? (
        <p className="intercept-off-note fine" role="status">
          Intercept angle is <strong>0°</strong> — target radial and intercept-heading lines are hidden on the map. Set
          the angle above 0° to show them when you are not yet on the target line.
        </p>
      ) : null}
    </div>
  );
}
