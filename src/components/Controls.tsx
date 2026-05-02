type Props = {
  paused: boolean;
  /** True when the physics loop is advancing (not paused). */
  simRunning: boolean;
  onPauseToggle: () => void;
  onReset: () => void;
  heading: number;
  onHeading: (h: number) => void;
  airspeed: number;
  onAirspeed: (v: number) => void;
  windFrom: number;
  onWindFrom: (w: number) => void;
  windSpeed: number;
  onWindSpeed: (w: number) => void;
  /** Student mode: move using heading + ground speed (wind ignored for motion). */
  directGroundSpeedMode: boolean;
  onDirectGroundSpeedMode: (v: boolean) => void;
  /** Live GS from physics (wind mode) or typed value (student mode). */
  currentGroundSpeed: number;
  /** When enabling student mode via checkbox, seed GS from current sim GS. */
  onSeedGroundSpeedFromSnapshot: () => void;
  /** Typing GS enables student mode and sets speed in one step. */
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
  airspeed,
  onAirspeed,
  windFrom,
  onWindFrom,
  windSpeed,
  onWindSpeed,
  directGroundSpeedMode,
  onDirectGroundSpeedMode,
  currentGroundSpeed,
  onSeedGroundSpeedFromSnapshot,
  applyGroundSpeedTyped,
  directGroundSpeed,
  onDirectGroundSpeed,
}: Props) {
  const clampGs = (v: number) =>
    Math.max(25, Math.min(280, Math.round(Number.isFinite(v) ? v : directGroundSpeed)));

  const normalizeHeading = (v: number) => (((v % 360) + 360) % 360);

  const gsDisplay = directGroundSpeedMode ? directGroundSpeed : Math.round(currentGroundSpeed);

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

      <label className="ctl ctl-checkbox">
        <span title="Set heading and ground speed directly; wind does not change track">
          Student: heading + GS
        </span>
        <input
          type="checkbox"
          checked={directGroundSpeedMode}
          onChange={(e) => {
            const on = e.target.checked;
            if (on) onSeedGroundSpeedFromSnapshot();
            onDirectGroundSpeedMode(on);
          }}
          className="ctl-check"
        />
      </label>

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
        <span title="Type a value to jump into student GS mode, or edit while in student mode">
          Ground speed (kt)
        </span>
        <input
          type="number"
          min={25}
          max={280}
          value={gsDisplay}
          onChange={(e) => applyGroundSpeedTyped(clampGs(Number(e.target.value)))}
          className="num wide"
          aria-label="Ground speed knots"
        />
        <div className="ctl-gs-extra">
          {directGroundSpeedMode ? (
            <>
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
            </>
          ) : (
            <span className="ctl-hint">Wind mode — type GS to switch to student mode</span>
          )}
        </div>
      </label>

      {directGroundSpeedMode ? (
        <p className="ctl-note">Wind controls hidden — using heading + GS for motion.</p>
      ) : (
        <>
          <label className="ctl">
            <span title="True airspeed">Airspeed (kt)</span>
            <input
              type="range"
              min={60}
              max={180}
              value={airspeed}
              onChange={(e) => onAirspeed(Number(e.target.value))}
            />
            <input
              type="number"
              min={40}
              max={250}
              value={airspeed}
              onChange={(e) => onAirspeed(Math.max(40, Math.min(250, Number(e.target.value) || airspeed)))}
              className="num wide"
              aria-label="Airspeed knots"
            />
          </label>

          <label className="ctl">
            <span title="Wind FROM">Wind from (°)</span>
            <input
              type="range"
              min={0}
              max={359}
              value={Math.round(windFrom)}
              onChange={(e) => onWindFrom(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={359}
              value={Math.round(windFrom)}
              onChange={(e) => onWindFrom(Number(e.target.value) % 360)}
              className="num wide"
              aria-label="Wind from degrees"
            />
          </label>

          <label className="ctl">
            <span>Wind speed (kt)</span>
            <input
              type="range"
              min={0}
              max={60}
              value={windSpeed}
              onChange={(e) => onWindSpeed(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={80}
              value={windSpeed}
              onChange={(e) => onWindSpeed(Math.max(0, Math.min(80, Number(e.target.value) || 0)))}
              className="num wide"
              aria-label="Wind speed knots"
            />
          </label>
        </>
      )}
    </div>
  );
}
