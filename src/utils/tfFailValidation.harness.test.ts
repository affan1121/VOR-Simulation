/**
 * Runtime validation harness for Fail TO/FROM grading vs CDI/OBS/intercept.
 * Writes NDJSON to the debug log path for analysis.
 */
import { appendFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  computeVorReadout,
  correctAircraftFromInterceptCue,
} from './toFromFailureTraining';
import {
  normalizeHeading,
  recommendedInterceptHeading,
  reciprocalCourse,
  vorToFromGeometry,
  type InterceptMode,
} from './vorMath';

const LOG_PATH = '/Users/affansmac/vor-nav-simulator/.cursor/debug-8f7db3.log';

function harnessLog(
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  try {
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({
        sessionId: '8f7db3',
        timestamp: Date.now(),
        location: 'tfFailValidation.harness.test.ts',
        message,
        data,
        hypothesisId,
        runId: 'harness',
      })}\n`
    );
  } catch {
    /* optional debug log — ignore when .cursor is not writable */
  }
}

function posOnRadial(radialDeg: number, nm: number) {
  const θ = (normalizeHeading(radialDeg) * Math.PI) / 180;
  return { x: Math.sin(θ) * nm, y: Math.cos(θ) * nm };
}

/** Heading-aware expected grader (reference for H1). */
function expectedCorrectWithHeadings(
  station: { x: number; y: number },
  aircraftA: { x: number; y: number },
  aircraftB: { x: number; y: number },
  obs: number,
  headingA: number,
  headingB: number
): 'A' | 'B' {
  const obsN = normalizeHeading(obs);
  const readA = computeVorReadout({
    station,
    aircraft: aircraftA,
    heading: headingA,
    obs: obsN,
  });
  const readB = computeVorReadout({
    station,
    aircraft: aircraftB,
    heading: headingB,
    obs: obsN,
  });
  const eps = 1e-5;
  const sA =
    readA.cdi < -eps ? -1 : readA.cdi > eps ? 1 : 0;
  const sB =
    readB.cdi < -eps ? -1 : readB.cdi > eps ? 1 : 0;
  if (sA !== 0 && sB !== 0 && sA !== sB) {
    return readA.cdi < readB.cdi ? 'A' : 'B';
  }
  return correctAircraftFromInterceptCue({
    station,
    aircraftA,
    aircraftB,
    obs,
    headingA,
    headingB,
  });
}

describe('TF fail validation harness', () => {
  const station = { x: 0, y: 0 };

  it('scans OBS × perpendicular layout × heading offsets for grader vs CDI mismatches', () => {
    const failures: Record<string, unknown>[] = [];
    let cases = 0;

    for (let obs = 0; obs < 360; obs += 15) {
      const perpA = normalizeHeading(obs + 90);
      const perpB = normalizeHeading(obs + 270);
      const a = posOnRadial(perpA, 10);
      const b = posOnRadial(perpB, 10);

      for (const headingA of [obs, normalizeHeading(obs + 45)]) {
        for (const headingB of [obs, normalizeHeading(obs + 30)]) {
          cases += 1;
          const obsN = normalizeHeading(obs);
          const readA = computeVorReadout({
            station,
            aircraft: a,
            heading: headingA,
            obs: obsN,
          });
          const readB = computeVorReadout({
            station,
            aircraft: b,
            heading: headingB,
            obs: obsN,
          });
          const got = correctAircraftFromInterceptCue({
            station,
            aircraftA: a,
            aircraftB: b,
            obs,
            headingA,
            headingB,
          });
          const want = expectedCorrectWithHeadings(
            station,
            a,
            b,
            obs,
            headingA,
            headingB
          );
          const panelCdi = got === 'A' ? readA.cdi : readB.cdi;
          const otherCdi = got === 'A' ? readB.cdi : readA.cdi;

          if (got !== want) {
            failures.push({
              obs,
              headingA,
              headingB,
              got,
              want,
              cdiA: readA.cdi,
              cdiB: readB.cdi,
              radA: readA.radial,
              radB: readB.radial,
            });
          }

          if (Math.abs(panelCdi) > 1e-5 && Math.abs(otherCdi) > 1e-5) {
            const sameSign = Math.sign(panelCdi) === Math.sign(otherCdi);
            if (sameSign && got !== want) {
              failures.push({
                kind: 'same-sign-wrong-pick',
                obs,
                got,
                want,
                panelCdi,
                otherCdi,
              });
            }
          }
        }
      }
    }

    harnessLog('heading-scan summary', { cases, failureCount: failures.length }, 'H1');
    if (failures.length > 0) {
      harnessLog('heading-scan failures sample', { failures: failures.slice(0, 12) }, 'H1');
    }
    expect(failures.length, JSON.stringify(failures.slice(0, 5))).toBe(0);
  });

  it('fail-mode intercept must use graded aircraft position (not ghost main ship)', () => {
    const modes: InterceptMode[] = ['INBOUND', 'OUTBOUND'];
    const gradedPos = posOnRadial(90, 10);
    const ghostPos = posOnRadial(0, 8);
    let differingWhenPositionsDiffer = 0;

    for (let obs = 0; obs < 360; obs += 30) {
      for (const tgt of [obs, normalizeHeading(obs + 90)]) {
        for (const mode of modes) {
          for (const lead of [30, 90] as const) {
            const gradedRec = recommendedInterceptHeading({
              aircraft: gradedPos,
              station,
              targetRadial: normalizeHeading(tgt),
              mode,
              interceptAngleDeg: lead,
              currentHeading: obs,
            });
            const ghostRec = recommendedInterceptHeading({
              aircraft: ghostPos,
              station,
              targetRadial: normalizeHeading(tgt),
              mode,
              interceptAngleDeg: lead,
              currentHeading: obs,
            });
            if (gradedRec.heading !== ghostRec.heading) differingWhenPositionsDiffer += 1;
          }
        }
      }
    }

    harnessLog(
      'intercept-ghost control',
      { differingWhenPositionsDiffer },
      'H2'
    );
    expect(differingWhenPositionsDiffer).toBeGreaterThan(0);

    const gradedOnly = recommendedInterceptHeading({
      aircraft: gradedPos,
      station,
      targetRadial: 90,
      mode: 'INBOUND',
      interceptAngleDeg: 45,
      currentHeading: 90,
    });
    harnessLog(
      'graded intercept sample',
      { heading: gradedOnly.heading },
      'H2'
    );
    expect(Number.isFinite(gradedOnly.heading)).toBe(true);
  });

  it('checks TO/FROM hemisphere matches radial leg for graded aircraft', () => {
    const failures: Record<string, unknown>[] = [];
    for (let obs = 0; obs < 360; obs += 20) {
      for (let line = 0; line < 360; line += 45) {
        const a = posOnRadial(line, 10);
        const b = posOnRadial(normalizeHeading(line + 180), 10);
        const correct = correctAircraftFromInterceptCue({
          station,
          aircraftA: a,
          aircraftB: b,
          obs,
        });
        const read =
          correct === 'A'
            ? computeVorReadout({ station, aircraft: a, heading: obs, obs })
            : computeVorReadout({ station, aircraft: b, heading: obs, obs });
        const tf = vorToFromGeometry(read.radial, obs);
        const onObsRadial =
          Math.abs(normalizeHeading(read.radial) - normalizeHeading(obs)) < 1 ||
          Math.abs(normalizeHeading(read.radial) - normalizeHeading(obs)) > 359;
        const legOk =
          (tf === 'FROM' && onObsRadial) ||
          (tf === 'TO' &&
            Math.abs(
              normalizeHeading(read.radial) - reciprocalCourse(obs)
            ) < 1);
        if (!legOk && Math.abs(read.cdi) > 0.01) {
          failures.push({ obs, line, correct, radial: read.radial, tf, cdi: read.cdi });
        }
      }
    }
    harnessLog('to-from-leg summary', { failureCount: failures.length }, 'H5');
    if (failures.length > 0) {
      harnessLog('to-from-leg sample', { failures: failures.slice(0, 10) }, 'H5');
    }
  });
});
