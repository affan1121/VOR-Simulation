import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { Position, ScenarioId } from './types';
import {
  buildToFromFailureTrainingScenario,
  computeVorReadout,
  correctAircraftFromGeometry,
  mirrorThroughStation,
} from './utils/toFromFailureTraining';
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
  const [failToFromFlag, setFailToFromFlag] = useState(false);
  const [toFromQuizChoice, setToFromQuizChoice] = useState<'A' | 'B' | null>(null);
  const [trainingPos, setTrainingPos] = useState<{ A: Position; B: Position } | null>(null);
  const [trainingHeadingA, setTrainingHeadingA] = useState<number | null>(null);
  const [trainingHeadingB, setTrainingHeadingB] = useState<number | null>(null);

  /** Last VOR position used for training A/B — only re-seed when the fix moves (new scenario), not when OBS changes. */
  const trainingStationRef = useRef<{ x: number; y: number } | null>(null);
  /** True while TO/FROM training mode has been entered — used to avoid re-seeding when only OBS/tfSeed updates. */
  const wasTrainingModeRef = useRef(false);

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

  const tfSeed = useMemo(() => {
    if (!failToFromFlag) return null;
    return buildToFromFailureTrainingScenario({
      station,
      obs: snapshot.obs,
      heading: snapshot.obs,
      dmeNm: 10,
    });
  }, [failToFromFlag, station, snapshot.obs]);

  useEffect(() => {
    if (!failToFromFlag || !tfSeed) {
      wasTrainingModeRef.current = false;
      trainingStationRef.current = null;
      setTrainingPos(null);
      setTrainingHeadingA(null);
      setTrainingHeadingB(null);
      return;
    }

    const enteringTraining = !wasTrainingModeRef.current;
    wasTrainingModeRef.current = true;

    const st = station;
    const prevFix = trainingStationRef.current;
    const stationChanged =
      prevFix == null || prevFix.x !== st.x || prevFix.y !== st.y;
    trainingStationRef.current = { x: st.x, y: st.y };

    const shouldReseedFromScenario = enteringTraining || stationChanged;

    setTrainingPos((prev) => {
      if (!shouldReseedFromScenario && prev) return prev;
      return {
        A: { ...tfSeed.aircraftA.aircraft },
        B: { ...tfSeed.aircraftB.aircraft },
      };
    });
    setTrainingHeadingA((prev) =>
      shouldReseedFromScenario || prev == null ? snapshot.obs : prev
    );
    setTrainingHeadingB((prev) =>
      shouldReseedFromScenario || prev == null ? 180 : prev
    );
  }, [failToFromFlag, tfSeed, station, snapshot.obs]);

  /**
   * Drag handler for training aircraft. The pair is constrained to a single line
   * through the VOR (cursor + station define the line direction), but each aircraft
   * keeps its own distance from the station, and an aircraft can be dragged **past
   * the station onto the opposite radial** without making the other aircraft jump.
   *
   * Behavior:
   * - The dragged aircraft snaps to the cursor; this sets the line direction.
   * - The other aircraft preserves its distance from the VOR and is placed on
   *   whichever side of the VOR (along the new line) is closest to its previous
   *   position. That keeps it stationary whenever the new line still passes through
   *   it (typical small drags), and avoids the visible teleport when the dragged
   *   aircraft slides through the VOR onto the opposite radial.
   * - When dragged across the VOR the two aircraft can momentarily share the same
   *   radial (both on R-α at different distances); rotating or pulling either back
   *   restores the opposite-radial layout.
   *
   * Edge case: if the dragged aircraft sits exactly on the VOR, the line direction
   * is undefined — we leave the other aircraft where it was.
   */
  const onMoveTrainingAircraft = useCallback(
    (id: 'A' | 'B', p: Position) => {
      setTrainingPos((prev) => {
        if (!prev) {
          return id === 'A'
            ? { A: p, B: mirrorThroughStation(station, p) }
            : { A: mirrorThroughStation(station, p), B: p };
        }

        const dx = p.x - station.x;
        const dy = p.y - station.y;
        const r = Math.hypot(dx, dy);

        const otherKey = id === 'A' ? 'B' : 'A';
        const oldOther = prev[otherKey];
        const distOther = Math.hypot(
          oldOther.x - station.x,
          oldOther.y - station.y
        );

        let newOther: Position;
        if (r < 1e-6) {
          newOther = oldOther;
        } else {
          const ux = dx / r;
          const uy = dy / r;
          const candSame: Position = {
            x: station.x + ux * distOther,
            y: station.y + uy * distOther,
          };
          const candOpp: Position = {
            x: station.x - ux * distOther,
            y: station.y - uy * distOther,
          };
          const dSame = Math.hypot(
            candSame.x - oldOther.x,
            candSame.y - oldOther.y
          );
          const dOpp = Math.hypot(
            candOpp.x - oldOther.x,
            candOpp.y - oldOther.y
          );
          newOther = dSame <= dOpp ? candSame : candOpp;
        }

        return id === 'A' ? { A: p, B: newOther } : { A: newOther, B: p };
      });
    },
    [station]
  );

  const tfTraining = useMemo(() => {
    if (!failToFromFlag || !tfSeed || !trainingPos) return tfSeed;
    const a = computeVorReadout({
      station,
      aircraft: trainingPos.A,
      heading: trainingHeadingA ?? snapshot.obs,
      obs: snapshot.obs,
    });
    const b = computeVorReadout({
      station,
      aircraft: trainingPos.B,
      heading: trainingHeadingB ?? snapshot.obs,
      obs: snapshot.obs,
    });
    const correct = correctAircraftFromGeometry({
      station,
      aircraftA: trainingPos.A,
      aircraftB: trainingPos.B,
      obs: snapshot.obs,
    });
    return { obs: snapshot.obs, aircraftA: a, aircraftB: b, correct };
  }, [failToFromFlag, tfSeed, trainingPos, station, snapshot.obs, trainingHeadingA, trainingHeadingB]);

  return (
    <div className="app">
      <StartHere />

      <header className="hero">
        <div>
          <h1>INRAT Exam Prep VOR Simulator</h1>
        </div>
      </header>

      <StudentGuide />

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

      <section className="card tf-fail-card">
        <div className="tf-fail-row">
          <div>
            <h3 className="tf-fail-title">TO/FROM Flag Failure Training Mode</h3>
            <p className="tf-fail-sub">
              If the TO/FROM flag is unreliable, the <strong>CDI still tells you</strong> whether the selected course is
              left or right — but you must use <strong>position awareness</strong> to avoid tracking the wrong course.
            </p>
          </div>
          <label className="tf-fail-toggle">
            <input
              type="checkbox"
              className="ctl-check"
              checked={failToFromFlag}
              onChange={(e) => {
                setFailToFromFlag(e.target.checked);
                setToFromQuizChoice(null);
                if (!e.target.checked) {
                  setTrainingHeadingA(null);
                  setTrainingHeadingB(null);
                }
              }}
            />{' '}
            Fail TO/FROM Flag
          </label>
        </div>

        {failToFromFlag && (
          <div className="tf-fail-warning" role="status" aria-live="polite">
            TO/FROM flag failed — use CDI and position awareness.
          </div>
        )}

        {failToFromFlag && (
          <div className="tf-heading-controls">
            <label className="tf-heading-ctl">
              <span>Heading A</span>
              <input
                type="number"
                min={0}
                max={359}
                value={Math.round(trainingHeadingA ?? snapshot.obs)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setTrainingHeadingA(normalizeHeading(v));
                }}
                className="num"
              />
            </label>
            <label className="tf-heading-ctl">
              <span>Heading B</span>
              <input
                type="number"
                min={0}
                max={359}
                value={Math.round(trainingHeadingB ?? snapshot.obs)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setTrainingHeadingB(normalizeHeading(v));
                }}
                className="num"
              />
            </label>
          </div>
        )}

        {failToFromFlag && tfTraining && (
          <div>
            <div className="tf-quiz">
              <h4 className="tf-quiz-q">Quiz</h4>
              <p className="tf-quiz-p">Which aircraft is on the correct side to intercept/track the selected radial?</p>
              <div className="seg">
                <button type="button" className="btn" onClick={() => setToFromQuizChoice('A')}>
                  Aircraft A
                </button>
                <button type="button" className="btn" onClick={() => setToFromQuizChoice('B')}>
                  Aircraft B
                </button>
              </div>

              {toFromQuizChoice && (
                <div className="tf-quiz-a">
                  {toFromQuizChoice === tfTraining.correct ? (
                    <div className="tf-quiz-correct">Correct: Aircraft {tfTraining.correct}.</div>
                  ) : (
                    <div className="tf-quiz-wrong">Not quite. Correct: Aircraft {tfTraining.correct}.</div>
                  )}

                  <p className="tf-quiz-exp">
                    <strong>Why:</strong> With the flag failed, you can’t depend on TO/FROM to tell you whether the OBS
                    course is inbound or outbound. The aircraft on the <strong>outbound side</strong> of the selected
                    course line (where a working flag would show <strong>FROM</strong>) is the one that’s on the named
                    radial <strong>R-OBS</strong>. The opposite side corresponds to the reciprocal radial and would normally
                    show <strong>TO</strong>.
                  </p>
                  <p className="tf-quiz-exp">
                    <strong>CDI deflection:</strong> the needle shows which way the selected course lies. If the needle
                    is deflected <strong>right</strong>, the selected course is to your right (turn right toward the
                    needle). If it’s <strong>left</strong>, the course is to your left.
                  </p>
                  <p className="tf-quiz-exp">
                    <strong>Safety note:</strong> a failed/misleading TO/FROM indication can make you confidently track
                    the wrong side of the station. The CDI still provides left/right guidance — but only if you pair it
                    with where you are relative to the VOR and the selected OBS course.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
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
            failToFromFlag={failToFromFlag}
            hideMainAircraft={failToFromFlag}
            hideLegend={true}
            trainingRadialLineDeg={failToFromFlag ? snapshot.obs : undefined}
            extraAircraft={
              failToFromFlag && tfTraining
                ? [
                    {
                      id: 'A',
                      aircraft: tfTraining.aircraftA.aircraft,
                      heading: tfTraining.aircraftA.heading,
                      label: 'Aircraft A',
                      courseErrorDeg: tfTraining.aircraftA.courseErrorDeg,
                    },
                    {
                      id: 'B',
                      aircraft: tfTraining.aircraftB.aircraft,
                      heading: tfTraining.aircraftB.heading,
                      label: 'Aircraft B',
                      courseErrorDeg: tfTraining.aircraftB.courseErrorDeg,
                    },
                  ]
                : undefined
            }
            onMoveExtraAircraft={failToFromFlag ? onMoveTrainingAircraft : undefined}
            interceptRadial={!failToFromFlag && interceptMapActive ? targetRadial : undefined}
            interceptHeading={!failToFromFlag && interceptMapActive ? interceptRec.heading : undefined}
            interceptAngleDeg={!failToFromFlag && interceptMapActive ? interceptAngle : undefined}
            onMoveAircraft={failToFromFlag ? undefined : moveAircraftTo}
            onAircraftDragActive={setAircraftDragging}
            planMapClampHalfNm={mapViewportHalfNm}
            registerPlanMapViewportHalfNm={registerMapViewportHalfNm}
          />
        </div>

        <div className="col vor-col">
          {failToFromFlag && tfTraining ? (
            <div className="single-tf-vor">
              <div className="vor-clone">
                <h4 className="vor-mini-title">VOR (TO/FROM failed)</h4>
                <VorIndicator
                  hideControls={false}
                  hideReadouts={true}
                  obs={snapshot.obs}
                  heading={tfTraining.aircraftA.heading}
                  bearingToStation={tfTraining.aircraftA.bearingToStation}
                  radial={tfTraining.aircraftA.radial}
                  dmeNm={tfTraining.aircraftA.dmeNm}
                  cdi={tfTraining.aircraftA.cdi}
                  toFrom={tfTraining.aircraftA.toFromGeometry}
                  navValid={true}
                  vorFlagsValid={true}
                  inCone={false}
                  failToFromFlag={true}
                  onObsChange={(v) => setObs(v)}
                />
                <p className="vor-cdi-dev">
                  Aircraft A radial: <strong>R-{formatMagneticThreeDigit360(tfTraining.aircraftA.radial)}°</strong>
                </p>
                <p className="vor-cdi-dev">
                  Aircraft B radial: <strong>R-{formatMagneticThreeDigit360(tfTraining.aircraftB.radial)}°</strong>
                </p>
                <p className="vor-cdi-dev">
                  CDI (Aircraft A):{' '}
                  <strong>
                    {Math.abs(tfTraining.aircraftA.courseErrorDeg).toFixed(1)}°{' '}
                    {tfTraining.aircraftA.cdi < 0 ? 'LEFT' : tfTraining.aircraftA.cdi > 0 ? 'RIGHT' : 'CENTER'}
                  </strong>
                </p>
              </div>
            </div>
          ) : (
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
              failToFromFlag={failToFromFlag}
              onObsChange={(v) => setObs(v)}
              onSetDistanceNm={setDistanceFromStation}
              dmeViewportHalfNm={mapViewportHalfNm}
            />
          )}
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
    </div>
  );
}
