import type { VORReadout } from '../utils/toFromFailureTraining';
import { normalizeHeading, VOR_CDI_DOT_STEP_DEG, VOR_CDI_FULL_SCALE_DEG } from '../utils/vorMath';

type Props = {
  title: string;
  readout: VORReadout;
  /** Training toggle: show the flag as failed/unreliable (OFF). */
  failToFromFlag: boolean;
};

const DOT_COUNT_PER_SIDE = VOR_CDI_FULL_SCALE_DEG / VOR_CDI_DOT_STEP_DEG;
const CDI_PX_FULL = 18;
const DOT_OFFSETS = Array.from({ length: DOT_COUNT_PER_SIDE }, (_, i) => ((i + 1) / DOT_COUNT_PER_SIDE) * CDI_PX_FULL);

export function MiniVorCdi({ title, readout, failToFromFlag }: Props) {
  const needleX = readout.cdi * CDI_PX_FULL;
  const flagText = failToFromFlag ? 'OFF' : readout.toFromGeometry === 'TO' ? 'TO' : 'FR';
  const obs = normalizeHeading(readout.obs);
  const labels = [0, 90, 180, 270] as const;

  return (
    <div className="mini-vor" aria-label={`${title} mini VOR`}>
      <div className="mini-vor-head">
        <span className="mini-vor-title">{title}</span>
        <span className="mini-vor-flag" data-failed={failToFromFlag ? 'true' : 'false'}>
          {flagText}
        </span>
      </div>

      <svg viewBox="0 0 140 140" className="mini-vor-svg" aria-hidden>
        <circle cx="70" cy="70" r="62" fill="#0f1624" stroke="#304058" strokeWidth="2" />
        <path d="M 70 8 L 74 15 L 66 15 Z" fill="#ffd447" />

        {/* OBS card labels rotating like the full instrument */}
        {labels.map((d) => {
          const face = normalizeHeading(d - obs);
          const rad = (face * Math.PI) / 180;
          const x = 70 + Math.sin(rad) * 51;
          const y = 70 - Math.cos(rad) * 51;
          const text = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : 'W';
          return (
            <text
              key={d}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#b5cae7"
              fontSize="9"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              {text}
            </text>
          );
        })}

        <g opacity={0.95}>
          {DOT_OFFSETS.flatMap((off) => [-off, off]).map((dx) => (
            <circle key={`d-${dx}`} cx={70 + dx} cy={70} r={1.8} fill="#142033" stroke="#87a2c8" strokeWidth="0.8" />
          ))}
        </g>
        <g transform={`translate(${needleX} 0)`} opacity={0.98}>
          <line x1="70" y1="48" x2="70" y2="92" stroke="#f4d03f" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <rect x="86" y="48" width="30" height="14" rx="4" fill="#111824" stroke="#3a4d67" strokeWidth="1" />
        <text
          x="101"
          y="55"
          textAnchor="middle"
          dominantBaseline="middle"
          fill={failToFromFlag ? '#ffd9b8' : '#c5e8ff'}
          fontSize="8"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
        >
          {flagText}
        </text>
        <circle cx="70" cy="70" r="3.5" fill="#141d2e" stroke="#41526a" strokeWidth="1.2" />
      </svg>

      <div className="mini-vor-meta">
        <span className="mini-chip">OBS {Math.round(readout.obs).toString().padStart(3, '0')}°</span>
        <span className="mini-chip">R-{(Math.round(readout.radial) || 0).toString().padStart(3, '0')}°</span>
        <span className="mini-chip">DME {readout.dmeNm.toFixed(1)} NM</span>
      </div>
    </div>
  );
}

