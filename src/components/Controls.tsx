type Props = {
  paused: boolean;
  /** True when the physics loop is advancing (not paused). */
  simRunning: boolean;
  onPauseToggle: () => void;
  onReset: () => void;
  heading: number;
  onHeading: (h: number) => void;
  /** Typing GS sets speed in one step (clamped). */
  applyGroundSpeedTyped: (kt: number) => void;
  directGroundSpeed: number;
  onDirectGroundSpeed: (kt: number) => void;
};

export function Controls({
  paused,
  simRunning,
  onPauseToggle,
  onReset,
  heading,
  onHeading,
  applyGroundSpeedTyped,
  directGroundSpeed,
  onDirectGroundSpeed,
}: Props) {
  const clampGs = (v: number) =>
    Math.max(25, Math.min(280, Math.round(Number.isFinite(v) ? v : directGroundSpeed)));

  const normalizeHeading = (v: number) => (((v % 360) + 360) % 360);

  return (
    <div className="controls card">
      <div className={`sim-status ${simRunning ? 'run' : 'hold'}`} role="status">
        {simRunning ? 'Simulation running — aircraft moving' : 'Paused — time frozen'}
      </div>
      <div className="controls-row">
        <button type="button" className="btn primary" onClick={onPauseToggle}>
          {paused ? 'Play' : 'Pause'}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          Reset
        </button>
      </div>

      <label className="ctl ctl-heading-row">
        <span title="Magnetic heading — type or use slider">Heading (°)</span>
        <div className="ctl-heading-num-slider">
          <input
            type="number"
            min={0}
            max={359}
            value={Math.round(heading)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              onHeading(normalizeHeading(v));
            }}
            className="num wide"
            aria-label="Heading degrees"
          />
          <input
            type="range"
            min={0}
            max={359}
            value={Math.round(heading)}
            onChange={(e) => onHeading(Number(e.target.value))}
            aria-label="Heading slider"
          />
        </div>
        <div className="turn-btns">
          <button type="button" className="btn sm" onClick={() => onHeading((heading - 5 + 360) % 360)}>
            ← 5°
          </button>
          <button type="button" className="btn sm" onClick={() => onHeading((heading + 5) % 360)}>
            5° →
          </button>
          <button type="button" className="btn sm" onClick={() => onHeading((heading - 1 + 360) % 360)}>
            ← 1°
          </button>
          <button type="button" className="btn sm" onClick={() => onHeading((heading + 1) % 360)}>
            1° →
          </button>
        </div>
      </label>

      <label className="ctl ctl-gs-row">
        <span title="Ground speed along heading">Ground speed (kt)</span>
        <input
          type="number"
          min={25}
          max={280}
          value={directGroundSpeed}
          onChange={(e) => applyGroundSpeedTyped(clampGs(Number(e.target.value)))}
          className="num wide"
          aria-label="Ground speed knots"
        />
        <div className="ctl-gs-extra">
          <input
            type="range"
            min={40}
            max={240}
            value={directGroundSpeed}
            onChange={(e) => onDirectGroundSpeed(clampGs(Number(e.target.value)))}
            className="ctl-gs-range"
            aria-label="Ground speed slider"
          />
          <span className="ctl-val">{directGroundSpeed}</span>
        </div>
      </label>
    </div>
  );
}
