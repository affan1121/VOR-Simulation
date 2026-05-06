import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react';
import { useCallback, useRef } from 'react';
import {
  DME_EDIT_MAX_NM,
  DME_EDIT_MIN_NM,
  MAP_PLAN_DME_MARGIN_NM,
  MAP_PLAN_VIEW_HALF_NM,
  maxDistanceNmAlongRadialInExtents,
  normalizeHeading,
  VOR_CDI_DOT_STEP_DEG,
  VOR_CDI_FULL_SCALE_DEG,
} from '../utils/vorMath';

const SYMMETRIC_CHART_HALF_NM_FALLBACK =
  MAP_PLAN_VIEW_HALF_NM - MAP_PLAN_DME_MARGIN_NM;

type Props = {
  title?: string;
  compact?: boolean;
  hideControls?: boolean;
  hideReadouts?: boolean;
  hideCompassText?: boolean;
  obs: number;
  heading: number;
  bearingToStation: number;
  radial: number;
  dmeNm: number;
  cdi: number;
  toFrom: 'TO' | 'FROM';
  navValid: boolean;
  /** False when flags blank — overhead cone or strict TO/FROM hemisphere boundary only. */
  vorFlagsValid: boolean;
  /** Training mode: intentionally fail/hide the TO/FROM flag display. */
  failToFromFlag?: boolean;
  inCone: boolean;
  obsInputRef?: RefObject<HTMLInputElement>;
  onObsChange: (v: number) => void;
  /** When set, DME readout becomes a control (moves aircraft along current radial). */
  onSetDistanceNm?: (nm: number) => void;
  /** Plan map ±NM from station (east/north) — caps DME so the airplane stays on the canvas. */
  dmeViewportHalfNm?: { halfEastNm: number; halfNorthNm: number };
};

/** Bearing in degrees → SVG coords on circle radius r from center (cx,cy). North = up. */
function ringPoint(cx: number, cy: number, bearingDeg: number, r: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  return [cx + Math.sin(rad) * r, cy - Math.cos(rad) * r];
}

/** Lateral px per unit CDI deflection; ±1 = ±full-scale course error. */
const CDI_PX_FULL = 52;
const CDI_FULL_SCALE_DEG = VOR_CDI_FULL_SCALE_DEG;
const CDI_DOT_STEP_DEG = VOR_CDI_DOT_STEP_DEG;
/** Half-scale lateral px — aligns TO/FR window at mid-scale. */
const CDI_HALF_DOT_PX = (CDI_PX_FULL * (CDI_FULL_SCALE_DEG / 2)) / CDI_FULL_SCALE_DEG;
/** Four dots each side at 4°, 6°, 8°, 10° — inner 2° dot omitted; spacing still 2° to full scale. */
const CDI_DOT_COUNT_PER_SIDE = CDI_FULL_SCALE_DEG / CDI_DOT_STEP_DEG - 1;
const CDI_DOT_OFFSETS_PX = Array.from({ length: CDI_DOT_COUNT_PER_SIDE }, (_, i) =>
  (((i + 2) * CDI_DOT_STEP_DEG) / CDI_FULL_SCALE_DEG) * CDI_PX_FULL
);
/** Outer ends of radial ticks — inset so labels sit clearly outside tick lines. */
const TICK_OUTER_R = 79;
/** Degree / cardinal labels — radially outside tick tips with comfortable gap. */
const LABEL_RING_R = 94;
/** Outer instrument bezel; keeps digits off the rim. */
const FACE_RADIUS = 110;

/** Pointer position relative to element center → OBS ° (clockwise from north / lubber up). */
function pointerToObsDeg(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round(deg) % 360;
}

function ObsKnob({ obs, onObsChange }: { obs: number; onObsChange: (v: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  const pushObs = useCallback(
    (next: number) => {
      const v = ((next % 360) + 360) % 360;
      if (v !== Math.round(obs)) onObsChange(v);
    },
    [obs, onObsChange]
  );

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const next = pointerToObsDeg(clientX, clientY, el.getBoundingClientRect());
      onObsChange(next);
    },
    [onObsChange]
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    applyPointer(e.clientX, e.clientY);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyPointer(e.clientX, e.clientY);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      pushObs(Math.round(obs) + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      pushObs(Math.round(obs) - 1);
    }
  };

  return (
    <div
      ref={rootRef}
      className="vor-obs-knob vor-obs-knob-plain"
      role="slider"
      tabIndex={0}
      aria-label="OBS rotate knob"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(obs)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span
        className="vor-obs-knob-dial"
        style={{ transform: `rotate(${obs}deg)` }}
        aria-hidden
      >
        <span className="vor-obs-knob-marker" />
      </span>
      <span className="vor-obs-knob-face-label">OBS</span>
    </div>
  );
}

/**
 * Fixed compass rose: tick lines stay on the bezel; only the printed numbers (and cardinals)
 * move with OBS so the selected course sits under the top lubber. CDI needle + four deviation
 * dots each side (4°–10° by 2°, inner 2° omitted).
 */
export function VorIndicator({
  title,
  compact,
  hideControls,
  hideReadouts,
  hideCompassText,
  obs,
  heading,
  bearingToStation: _bearingToStation,
  radial,
  dmeNm,
  cdi,
  toFrom,
  navValid,
  vorFlagsValid,
  failToFromFlag,
  inCone,
  obsInputRef,
  onObsChange,
  onSetDistanceNm,
  dmeViewportHalfNm,
}: Props) {
  const needleX = cdi * CDI_PX_FULL;
  const cx = 110;
  const cy = 110;
  const flagsOk = vorFlagsValid && !failToFromFlag;
  // Training flag-failure should not dim a valid CDI needle.
  const indicatorOk = navValid;
  /** Dashed cue — overhead / cone passage only (abeam ambiguity uses OFF flag without this bar). */
  const passageBlanking = navValid && inCone;

  /** Match map semantics: blue = TO hemisphere, warm = outbound / FROM (“FR”). */
  const toFromFlagPalette = !flagsOk
    ? { boxFill: '#0d1219', boxStroke: '#4a4f58', labelFill: '#6a7585' as const }
    : toFrom === 'TO'
      ? { boxFill: '#121f30', boxStroke: '#4690dc', labelFill: '#c5e8ff' as const }
      : { boxFill: '#221711', boxStroke: '#b67a52', labelFill: '#ffd6b8' as const };

  const ticks: ReactNode[] = [];
  for (let t = 0; t < 360; t += 5) {
    const isTen = t % 10 === 0;
    const isCard = t % 90 === 0;
    const len = isTen ? (isCard ? 15 : 12) : 5;
    const rOuter = TICK_OUTER_R;
    const rInner = rOuter - len;
    const [x1, y1] = ringPoint(cx, cy, t, rInner);
    const [x2, y2] = ringPoint(cx, cy, t, rOuter);
    ticks.push(
      <line
        key={`tk-${t}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={
          isTen ? (isCard ? '#d6e6fa' : '#9eb5d6') : '#5c6f88'
        }
        strokeWidth={isTen ? (isCard ? 2.6 : 2) : 1.15}
        strokeLinecap="round"
      />
    );
  }

  const labels: ReactNode[] = [];
  if (!hideCompassText) {
    for (let t = 0; t < 360; t += 30) {
      let text: string;
      if (t === 0) text = 'N';
      else if (t === 90) text = 'E';
      else if (t === 180) text = 'S';
      else if (t === 270) text = 'W';
      else text = t.toString().padStart(3, '0');
      const faceBearing = normalizeHeading(t - obs);
      const [wx, wy] = ringPoint(cx, cy, faceBearing, LABEL_RING_R);
      const isCard = t % 90 === 0;
      labels.push(
        <text
          key={`lb-${t}`}
          x={wx}
          y={wy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={isCard ? '#eef4fc' : '#b0c4df'}
          fontSize={isCard ? 14 : 10}
          fontWeight={isCard ? 700 : 600}
          fontFamily="JetBrains Mono, monospace"
        >
          {text}
        </text>
      );
    }
  }

  return (
    <div className={`vor-wrap ${compact ? 'vor-wrap-compact' : ''}`} aria-label="VOR indicator">
      {title && <h4 className="vor-mini-title">{title}</h4>}
      <div className="vor-face-wrap">
      <svg viewBox="0 0 220 220" className="vor-svg">
        <defs>
          <radialGradient id="vorFace" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#1a2332" />
            <stop offset="100%" stopColor="#0d1219" />
          </radialGradient>
        </defs>
        <circle cx="110" cy="110" r={FACE_RADIUS} fill="url(#vorFace)" stroke="#3d4f66" strokeWidth="3" />

        <g aria-hidden>{ticks}</g>
        <g aria-hidden>{labels}</g>

        {/* Lubber — compact; labels sit outside shortened ticks (see TICK_OUTER_R) */}
        <path
          d="M 110 4 L 114 11 L 106 11 Z"
          fill="#ffd447"
          stroke="#c9a227"
          strokeWidth="0.9"
          opacity={0.98}
          aria-hidden
        />
        <line x1="110" y1="4" x2="110" y2="10" stroke="#fff9e6" strokeWidth="1.5" strokeLinecap="round" opacity={0.9} />

        {/* Fixed lateral deviation dots — four per side (quarter-scale steps to full deflection). */}
        <g aria-hidden className="vor-cdi-scale">
          {CDI_DOT_OFFSETS_PX.flatMap((off) => [-off, off]).map((dx) => (
            <circle
              key={`dot-${dx}`}
              cx={cx + dx}
              cy={cy}
              r={2.3}
              fill="#3d4e62"
              stroke="#9eb5d6"
              strokeWidth={0.9}
              opacity={indicatorOk ? 0.95 : 0.35}
            />
          ))}
        </g>

        {/* CDI — vertical line only (no arrowhead); flagged when unreliable */}
        <g transform={`translate(${needleX} 0)`} opacity={indicatorOk ? 1 : 0.28}>
          <line
            x1={cx}
            y1={cy - 52}
            x2={cx}
            y2={cy + 52}
            stroke="#f4d03f"
            strokeWidth={2.75}
            strokeLinecap="round"
          />
        </g>

        {/* TO / FR — above right half-scale dot; lowered so it sits further below lubber / labels */}
        <rect
          x={cx + CDI_HALF_DOT_PX - 17}
          y={cy - 36}
          width="34"
          height="16"
          rx="4"
          fill={toFromFlagPalette.boxFill}
          stroke={toFromFlagPalette.boxStroke}
          strokeWidth="1.2"
          opacity={0.98}
        />
        <text
          x={cx + CDI_HALF_DOT_PX}
          y={cy - 27}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={toFromFlagPalette.labelFill}
          fontSize="10"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="0.06em"
        >
          {!flagsOk ? 'OFF' : toFrom === 'TO' ? 'TO' : 'FR'}
        </text>

        {/* Station passage — dashed line directly above TO/FR box */}
        {passageBlanking && (
          <g aria-hidden>
            <line
              x1={cx + CDI_HALF_DOT_PX - 20}
              y1={cy - 44}
              x2={cx + CDI_HALF_DOT_PX + 20}
              y2={cy - 44}
              stroke="#f0f4fa"
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.95}
            />
            <line
              x1={cx + CDI_HALF_DOT_PX - 20}
              y1={cy - 44}
              x2={cx + CDI_HALF_DOT_PX + 20}
              y2={cy - 44}
              stroke="#e04545"
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeDashoffset="5"
              strokeLinecap="round"
              opacity={0.9}
            />
          </g>
        )}

        <circle cx="110" cy="110" r="8" fill="#1c2533" stroke="#5c6e85" strokeWidth="2" />

        {inCone && navValid && (
          <text x="110" y="206" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="Plus Jakarta Sans, sans-serif">
            cone / unstable
          </text>
        )}
      </svg>
      <div className="vor-obs-knob-corner">
        <ObsKnob obs={obs} onObsChange={onObsChange} />
      </div>
      </div>

      {!hideControls && (
      <div className="vor-knob-row vor-obs-open">
        <label className="vor-knob-label vor-obs-open-inner">
          <span className="vor-obs-heading">OBS — selected course to index</span>
          <input
            ref={obsInputRef}
            type="number"
            min={0}
            max={359}
            value={Math.round(obs)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              onObsChange(((v % 360) + 360) % 360);
            }}
            className="vor-obs-input vor-obs-input-open"
            aria-label="OBS selector degrees"
          />
          <input
            type="range"
            min={0}
            max={359}
            value={Math.round(obs)}
            onChange={(e) => onObsChange(Number(e.target.value))}
            className="vor-obs-slider vor-obs-slider-open"
            aria-label="OBS knob"
          />
        </label>
      </div>
      )}

      {!hideReadouts && (
      <div className="vor-readouts vor-readouts-simple">
        <Readout label="CRS" value={`${Math.round(obs).toString().padStart(3, '0')}°`} hint="OBS selected course" />
        <Readout label="HDG" value={`${Math.round(heading).toString().padStart(3, '0')}°`} hint="Heading" />
        {onSetDistanceNm ? (
          <DmeControl
            radialDeg={radial}
            dmeNm={dmeNm}
            viewportHalfNm={dmeViewportHalfNm}
            onChange={onSetDistanceNm}
          />
        ) : (
          <Readout label="DME" value={`${dmeNm.toFixed(1)} NM`} hint="Distance" />
        )}
      </div>
      )}
    </div>
  );
}

function DmeControl({
  radialDeg,
  dmeNm,
  viewportHalfNm,
  onChange,
}: {
  radialDeg: number;
  dmeNm: number;
  viewportHalfNm?: { halfEastNm: number; halfNorthNm: number };
  onChange: (nm: number) => void;
}) {
  const he = viewportHalfNm?.halfEastNm ?? SYMMETRIC_CHART_HALF_NM_FALLBACK;
  const hn = viewportHalfNm?.halfNorthNm ?? SYMMETRIC_CHART_HALF_NM_FALLBACK;
  const maxNm = Math.min(
    DME_EDIT_MAX_NM,
    maxDistanceNmAlongRadialInExtents(radialDeg, he, hn)
  );
  const clamp = (n: number) =>
    Math.max(DME_EDIT_MIN_NM, Math.min(maxNm, n));
  const displayNm = Number.isFinite(dmeNm) ? dmeNm : DME_EDIT_MIN_NM;
  const sliderNm = clamp(displayNm);

  return (
    <div
      className="vor-readout vor-readout-dme"
      title="Distance from station (NM) along your current radial. Slider is limited so the airplane stays on the plan map."
    >
      <span className="vor-readout-label">DME (NM)</span>
      <div className="vor-dme-row">
        <input
          type="number"
          min={DME_EDIT_MIN_NM}
          max={maxNm}
          step={0.1}
          value={displayNm.toFixed(1)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onChange(clamp(v));
          }}
          className="vor-dme-number"
          aria-label="DME distance in nautical miles"
        />
      </div>
      <input
        type="range"
        min={DME_EDIT_MIN_NM}
        max={maxNm}
        step={0.5}
        value={sliderNm}
        onChange={(e) => onChange(Number(e.target.value))}
        className="vor-dme-slider"
        aria-label="DME distance"
      />
    </div>
  );
}

function Readout({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="vor-readout" title={hint}>
      <span className="vor-readout-label">{label}</span>
      <span className="vor-readout-value">{value}</span>
    </div>
  );
}
