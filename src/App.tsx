import { useCallback, useMemo, useState } from 'react';
import { Controls } from './components/Controls';
import { InterceptPanel } from './components/InterceptPanel';
import { MapCanvas } from './components/MapCanvas';
import { StudentGuide } from './components/StudentGuide';
import { TeachingPanel } from './components/TeachingPanel';
import { StartHere } from './components/StartHere';
import { VorIndicator } from './components/VorIndicator';
import { useSimulation } from './hooks/useSimulation';
import { SCENARIOS } from './scenarios';
import { generateRandomChallenge } from './randomScenario';
import {
  formatMagneticThreeDigit360,
  isEstablishedOnInterceptRadial,
  recommendedInterceptHeading,
  normalizeHeading,
  type InterceptMode,
} from './utils/vorMath';
import type { ScenarioId } from './types';
import './App.css';

export default function App() {
  const sim = useSimulation();
  const {
    snapshot,
    station,
    trailRef,
    loadInitial,
    reset,
    paused,
    setPaused,
    setHeading,
    setAirspeed,
    setWindFrom,
    setWindSpeed,
    setObs,
    heading,
    airspeed,
    windFrom,
    windSpeed,
    directGroundSpeedMode,
    setDirectGroundSpeedMode,
    directGroundSpeed,
    setDirectGroundSpeed,
    moveAircraftTo,
    setDistanceFromStation,
    setAircraftDragging,
    mapViewportHalfNm,
    registerMapViewportHalfNm,
  } = sim;

  const [scenarioId, setScenarioId] = useState<ScenarioId>('free');
  const [targetRadial, setTargetRadial] = useState(90);
  const [interceptMode, setInterceptMode] = useState<InterceptMode>('INBOUND');
  const [interceptAngle, setInterceptAngle] = useState(0);
  const [randomExplain, setRandomExplain] = useState<string | null>(null);

  const activeScenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId]
  );

  const applyScenario = useCallback(
    (id: ScenarioId) => {
      setScenarioId(id);
      const sc = SCENARIOS.find((s) => s.id === id);
      if (!sc) return;
      loadInitial(sc.initial);
      setRandomExplain(null);
      if (sc.interceptRadial !== undefined) setTargetRadial(sc.interceptRadial);
      if (sc.interceptMode) setInterceptMode(sc.interceptMode);
    },
    [loadInitial]
  );

  const interceptRec = recommendedInterceptHeading({
    aircraft: snapshot.aircraft,
    station,
    targetRadial: normalizeHeading(targetRadial),
    mode: interceptMode,
    interceptAngleDeg: interceptAngle,
    currentHeading: snapshot.heading,
  });

  /** Map intercept aids when lead > 0 and not yet established on the exact radial for inbound/outbound. */
  const interceptMapActive = useMemo(() => {
    if (interceptAngle <= 0) return false;
    return !isEstablishedOnInterceptRadial(
      snapshot.radial,
      normalizeHeading(targetRadial),
      interceptMode
    );
  }, [interceptAngle, snapshot.radial, targetRadial, interceptMode]);

  const applyGroundSpeedTyped = useCallback((kt: number) => {
    setDirectGroundSpeed(kt);
    setDirectGroundSpeedMode(true);
  }, []);

  const onRandom = () => {
    const ch = generateRandomChallenge();
    loadInitial(ch.initial);
    setTargetRadial(ch.goalRadial);
    setInterceptMode(ch.goalMode);
    setScenarioId('free');
    setRandomExplain(ch.explanation);
  };

  return (
    <div className="app">
      <StartHere />

      <header className="hero">
        <div>
          <h1>INRAT Exam Prep VOR Simulator</h1>
          <p className="sub">
            Use <strong>Student: heading + GS</strong> to type heading and ground speed, or use wind with airspeed. Set
            intercept angle by number under Intercept.
          </p>
        </div>
      </header>

      <section className="scenario-bar card scenario-bar-simple">
        <label>
          Scenario
          <select
            value={scenarioId}
            onChange={(e) => applyScenario(e.target.value as ScenarioId)}
            title="Load preset aircraft position and wind"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <p className="scenario-desc">{activeScenario.description}</p>
        <div className="scenario-actions">
          <button type="button" className="btn" onClick={onRandom}>
            Random
          </button>
        </div>
      </section>

      {randomExplain && (
        <div className="card random-explain">
          <h4>Random — notes</h4>
          <p dangerouslySetInnerHTML={{ __html: randomExplain.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
          <button type="button" className="btn sm" onClick={() => setRandomExplain(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="passage-banner" data-visible={snapshot.passageMessageActive}>
        Station passage — expect TO/FROM reversal and CDI instability near the cone
      </div>

      <main className="layout">
        <div className="col map-col">
          <MapCanvas
            station={station}
            aircraft={snapshot.aircraft}
            heading={snapshot.heading}
            track={snapshot.track}
            trailRef={trailRef}
            radial={snapshot.radial}
            obs={snapshot.obs}
            toFrom={snapshot.toFrom}
            interceptRadial={interceptMapActive ? targetRadial : undefined}
            interceptHeading={interceptMapActive ? interceptRec.heading : undefined}
            interceptAngleDeg={interceptMapActive ? interceptAngle : undefined}
            onMoveAircraft={moveAircraftTo}
            onAircraftDragActive={setAircraftDragging}
            planMapClampHalfNm={mapViewportHalfNm}
            registerPlanMapViewportHalfNm={registerMapViewportHalfNm}
          />
        </div>

        <div className="col vor-col">
          <VorIndicator
            obs={snapshot.obs}
            heading={snapshot.heading}
            bearingToStation={snapshot.bearingToStation}
            radial={snapshot.radial}
            dmeNm={snapshot.dmeNm}
            cdi={snapshot.cdi}
            toFrom={snapshot.toFrom}
            navValid={snapshot.navValid}
            vorFlagsValid={snapshot.vorFlagsValid}
            inCone={snapshot.inCone}
            onObsChange={(v) => setObs(v)}
            onSetDistanceNm={setDistanceFromStation}
            dmeViewportHalfNm={mapViewportHalfNm}
          />
          <div className="status-strip card status-strip-simple">
            <span title="Ground speed">GS {Math.round(snapshot.groundSpeed)} kt</span>
            <span title="Cross-track error">XTK {snapshot.courseErrorDeg.toFixed(1)}°</span>
            {interceptMapActive && (
              <span
                title="Suggested magnetic heading to intercept the target radial set in the Intercept panel (wind affects track)"
                className="status-int-hdg"
              >
                INT HDG {formatMagneticThreeDigit360(interceptRec.heading)}°
              </span>
            )}
          </div>
          <Controls
            paused={paused}
            onPauseToggle={() => setPaused((p) => !p)}
            onReset={reset}
            simRunning={!paused}
            heading={heading}
            onHeading={setHeading}
            airspeed={airspeed}
            onAirspeed={setAirspeed}
            windFrom={windFrom}
            onWindFrom={setWindFrom}
            windSpeed={windSpeed}
            onWindSpeed={setWindSpeed}
            directGroundSpeedMode={directGroundSpeedMode}
            currentGroundSpeed={snapshot.groundSpeed}
            onDirectGroundSpeedMode={setDirectGroundSpeedMode}
            onSeedGroundSpeedFromSnapshot={() =>
              setDirectGroundSpeed(Math.round(snapshot.groundSpeed))
            }
            applyGroundSpeedTyped={applyGroundSpeedTyped}
            directGroundSpeed={directGroundSpeed}
            onDirectGroundSpeed={setDirectGroundSpeed}
          />
        </div>

        <div className="col side-col">
          <TeachingPanel snapshot={snapshot} />
          <InterceptPanel
            station={station}
            snapshot={snapshot}
            targetRadial={targetRadial}
            onTargetRadial={(r) => setTargetRadial(normalizeHeading(r))}
            mode={interceptMode}
            onMode={setInterceptMode}
            interceptAngle={interceptAngle}
            onInterceptAngle={setInterceptAngle}
            interceptOverlayOnMap={interceptMapActive}
          />
        </div>
      </main>

      <footer className="foot foot-simple">
        <p>
          CDI full scale is 10° off course; four deviation dots each side at 4°, 6°, 8°, and 10° (2° dot omitted).
          Near the station,
          behavior is a training approximation only.
        </p>
      </footer>

      <StudentGuide />
    </div>
  );
}
