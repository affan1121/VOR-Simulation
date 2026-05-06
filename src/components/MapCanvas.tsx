import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Position } from '../types';
import {
  distanceNm,
  DME_EDIT_MIN_NM,
  formatMagneticThreeDigit360,
  MAP_PLAN_DME_MARGIN_NM,
  MAP_PLAN_VIEW_HALF_NM,
  MAP_VIEW_NM_TO_PX,
} from '../utils/vorMath';

/** Keep aircraft symbol and labels inside the canvas (pixels from each edge toward center). */
const MAP_EDGE_PAD_PX = 46;

/** Keep the radial readout pill off the station “VOR” label (screen px). */
const MIN_RADIAL_PILL_FROM_VOR_PX = 56;

const NM_TO_PX = MAP_VIEW_NM_TO_PX;
const VIEW_NM = MAP_PLAN_VIEW_HALF_NM;

/** Reference radials on the plan-view map (N/E/S/W only). */
const CARDINAL_RADIALS = [0, 90, 180, 270] as const;

function formatRadialDigits(radialDeg: number): string {
  const r = Math.round(radialDeg) % 360;
  return r === 0 ? '360' : r.toString().padStart(3, '0');
}

type Props = {
  station: Position;
  aircraft: Position;
  heading: number;
  track: number;
  trailRef: MutableRefObject<Position[]>;
  radial: number;
  obs: number;
  /** Hemispheric TO/FROM for current OBS + aircraft position (matches instrument). */
  toFrom: 'TO' | 'FROM';
  /** Training mode: intentionally fail/hide TO/FROM flag (map pill + legend). */
  failToFromFlag?: boolean;
  /** Hide the primary blue aircraft symbol. */
  hideMainAircraft?: boolean;
  hideLegend?: boolean;
  /** Training mode: draw one full radial line through both sides for A/B aircraft. */
  trainingRadialLineDeg?: number;
  interceptRadial?: number;
  /** Recommended magnetic heading to fly for the intercept (full line drawn through aircraft). */
  interceptHeading?: number;
  /** Lead angle from Intercept panel — shown on map readout. */
  interceptAngleDeg?: number;
  /**
   * Optional training aircraft rendered in addition to the main sim aircraft.
   * These are visual comparisons only (not draggable, no trail).
   */
  extraAircraft?: {
    id: 'A' | 'B';
    aircraft: Position;
    heading: number;
    label: string;
    /** Signed course error degrees for selected OBS (training overlay text). */
    courseErrorDeg?: number;
  }[];
  /** Drag training aircraft A/B directly on the map. */
  onMoveExtraAircraft?: (id: 'A' | 'B', p: Position) => void;
  /** Drag aircraft on the map (student positioning). */
  onMoveAircraft?: (p: Position) => void;
  /** True while pointer is dragging the aircraft. */
  onAircraftDragActive?: (active: boolean) => void;
  /** Half-extents (NM) derived from canvas size — must match simulator clamp/DME caps. */
  planMapClampHalfNm?: { halfEastNm: number; halfNorthNm: number };
  /** Publish viewport half-extents when the map host is measured or resized. */
  registerPlanMapViewportHalfNm?: (ext: {
    halfEastNm: number;
    halfNorthNm: number;
  }) => void;
};

function dedupeVerts(pts: Position[], eps = 1e-4): Position[] {
  const out: Position[] = [];
  for (const p of pts) {
    if (!out.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < eps)) out.push(p);
  }
  return out;
}

/**
 * Intersection of visible map square with VOR TO/FROM half-plane (same rule as vorToFrom dot product).
 * FROM: dot((P−station), outbound_OBS) ≥ 0 — brown side. TO is the opposite half (blue).
 */
function clipHalfPlaneSquare(
  station: Position,
  obsDeg: number,
  half: 'FROM' | 'TO',
  viewNm: number
): Position[] {
  const o = (obsDeg * Math.PI) / 180;
  const ux = Math.sin(o);
  const uy = Math.cos(o);
  const { x: sx, y: sy } = station;
  const dot = (p: Position) => (p.x - sx) * ux + (p.y - sy) * uy;
  const eps = 1e-7;
  const keep = half === 'FROM' ? (d: number) => d >= -eps : (d: number) => d <= eps;

  const W = viewNm;
  const corners: Position[] = [
    { x: -W, y: W },
    { x: W, y: W },
    { x: W, y: -W },
    { x: -W, y: -W },
  ];

  const verts: Position[] = [];
  for (const c of corners) {
    if (keep(dot(c))) verts.push({ ...c });
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const da = dot(a);
    const db = dot(b);
    if (da * db < -1e-12) {
      const t = da / (da - db);
      verts.push({
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      });
    }
  }

  const deduped = dedupeVerts(verts);
  if (deduped.length < 3) return deduped;

  deduped.sort((p, q) => {
    const ap = Math.atan2(p.y - sy, p.x - sx);
    const aq = Math.atan2(q.y - sy, q.x - sx);
    return ap - aq;
  });
  return deduped;
}

function fillPolygonWorld(
  ctx: CanvasRenderingContext2D,
  pts: Position[],
  worldToScreen: (wx: number, wy: number) => [number, number],
  fillStyle: string
) {
  if (pts.length < 3) return;
  ctx.beginPath();
  const [fx, fy] = worldToScreen(pts[0].x, pts[0].y);
  ctx.moveTo(fx, fy);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = worldToScreen(pts[i].x, pts[i].y);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

/**
 * Plan-view map: TO/FROM shading (OBS-dependent), radials, trail, draggable aircraft.
 */
export function MapCanvas({
  station,
  aircraft,
  heading,
  track,
  trailRef,
  radial,
  obs,
  toFrom,
  failToFromFlag,
  hideMainAircraft,
  hideLegend,
  trainingRadialLineDeg,
  interceptRadial,
  interceptHeading,
  interceptAngleDeg,
  extraAircraft,
  onMoveExtraAircraft,
  onMoveAircraft,
  onAircraftDragActive,
  planMapClampHalfNm,
  registerPlanMapViewportHalfNm,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const aircraftRef = useRef(aircraft);
  const stationRef = useRef(station);
  const paintRef = useRef<(() => void) | null>(null);

  const sceneRef = useRef({
    station,
    aircraft,
    heading,
    track,
    trailRef,
    radial,
    obs,
    toFrom,
    failToFromFlag,
    hideMainAircraft,
    hideLegend,
    trainingRadialLineDeg,
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
    extraAircraft,
    onMoveExtraAircraft,
  });
  sceneRef.current = {
    station,
    aircraft,
    heading,
    track,
    trailRef,
    radial,
    obs,
    toFrom,
    failToFromFlag,
    hideMainAircraft,
    hideLegend,
    trainingRadialLineDeg,
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
    extraAircraft,
    onMoveExtraAircraft,
  };

  useEffect(() => {
    aircraftRef.current = aircraft;
  }, [aircraft]);
  useEffect(() => {
    stationRef.current = station;
  }, [station]);

  useEffect(() => {
    const el = hostRef.current;
    const reg = registerPlanMapViewportHalfNm;
    if (!el || !reg) return;

    const publish = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const hw = w / 2 - MAP_EDGE_PAD_PX;
      const hh = h / 2 - MAP_EDGE_PAD_PX;
      reg({
        halfEastNm: Math.max(DME_EDIT_MIN_NM, hw / NM_TO_PX),
        halfNorthNm: Math.max(DME_EDIT_MIN_NM, hh / NM_TO_PX),
      });
    };

    publish();
    const ro = new ResizeObserver(() => publish());
    ro.observe(el);
    return () => ro.disconnect();
  }, [registerPlanMapViewportHalfNm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /* Center grab area — symbol spans ~±28 px; A/B get a slightly larger target. */
    const HIT_PX_MAIN = 52;
    const HIT_PX_TRAINING = 88;
    const symLim = VIEW_NM - MAP_PLAN_DME_MARGIN_NM;

    const screenToWorld = (px: number, py: number, cw: number, ch: number): Position => {
      const cx = cw / 2;
      const cy = ch / 2;
      let wx = (px - cx) / NM_TO_PX + stationRef.current.x;
      let wy = -(py - cy) / NM_TO_PX + stationRef.current.y;
      const halfE = planMapClampHalfNm?.halfEastNm ?? symLim;
      const halfN = planMapClampHalfNm?.halfNorthNm ?? symLim;
      wx = Math.max(-halfE, Math.min(halfE, wx));
      wy = Math.max(-halfN, Math.min(halfN, wy));
      return { x: wx, y: wy };
    };

    let dragging = false;
    let dragTarget: 'MAIN' | 'A' | 'B' | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = cw / 2;
      const cy = ch / 2;
      const scene = sceneRef.current;

      if (scene.extraAircraft?.length && scene.onMoveExtraAircraft) {
        for (const ex of scene.extraAircraft) {
          const exx = cx + ex.aircraft.x * NM_TO_PX;
          const exy = cy - ex.aircraft.y * NM_TO_PX;
          const dx = px - exx;
          const dy = py - exy;
          const hitR = HIT_PX_TRAINING;
          if (dx * dx + dy * dy <= hitR * hitR) {
            e.preventDefault();
            dragTarget = ex.id;
            dragging = true;
            canvas.setPointerCapture(e.pointerId);
            onAircraftDragActive?.(true);
            scene.onMoveExtraAircraft(ex.id, screenToWorld(px, py, cw, ch));
            return;
          }
        }
      }

      if (!scene.hideMainAircraft && onMoveAircraft) {
        const ac = aircraftRef.current;
        const acx = cx + ac.x * NM_TO_PX;
        const acy = cy - ac.y * NM_TO_PX;
        const dx = px - acx;
        const dy = py - acy;
        if (dx * dx + dy * dy > HIT_PX_MAIN * HIT_PX_MAIN) return;
        e.preventDefault();
        dragTarget = 'MAIN';
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        onAircraftDragActive?.(true);
        onMoveAircraft(screenToWorld(px, py, cw, ch));
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const p = screenToWorld(px, py, cw, ch);
      if (dragTarget === 'MAIN') onMoveAircraft?.(p);
      if ((dragTarget === 'A' || dragTarget === 'B') && sceneRef.current.onMoveExtraAircraft) {
        sceneRef.current.onMoveExtraAircraft(dragTarget, p);
      }
    };

    const finishDrag = (e?: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      dragTarget = null;
      if (e && canvas.hasPointerCapture(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      onAircraftDragActive?.(false);
    };

    const onLostCapture = () => {
      if (!dragging) return;
      dragging = false;
      dragTarget = null;
      onAircraftDragActive?.(false);
    };

    const nonPassive: AddEventListenerOptions = { passive: false };
    canvas.addEventListener('pointerdown', onPointerDown, nonPassive);
    canvas.addEventListener('pointermove', onPointerMove, nonPassive);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    canvas.addEventListener('lostpointercapture', onLostCapture);

    return () => {
      finishDrag();
      canvas.removeEventListener('pointerdown', onPointerDown, nonPassive);
      canvas.removeEventListener('pointermove', onPointerMove, nonPassive);
      canvas.removeEventListener('pointerup', finishDrag);
      canvas.removeEventListener('pointercancel', finishDrag);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
    };
  }, [onMoveAircraft, onMoveExtraAircraft, onAircraftDragActive, planMapClampHalfNm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas) return;
    const ctxMaybe = canvas.getContext('2d');
    if (!ctxMaybe) return;
    const ctx = ctxMaybe;

    const paint = () => {
      const {
        station,
        aircraft,
        heading,
        track,
        trailRef,
        radial,
        obs,
        toFrom,
        failToFromFlag,
        hideMainAircraft,
        trainingRadialLineDeg,
        interceptRadial,
        interceptHeading,
        interceptAngleDeg,
        extraAircraft,
      } = sceneRef.current;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cr = canvas.getBoundingClientRect();
      let cssW = Math.floor(cr.width);
      let cssH = Math.floor(cr.height);
      if (cssW < 16 || cssH < 16) {
        const hr = host?.getBoundingClientRect();
        cssW = Math.max(cssW, Math.floor(hr?.width ?? 0), 400);
        cssH = Math.max(cssH, Math.floor(hr?.height ?? 0), 360);
      }
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = cssW / 2;
      const cy = cssH / 2;

      function worldToScreen(wx: number, wy: number): [number, number] {
        return [cx + wx * NM_TO_PX, cy - wy * NM_TO_PX];
      }

      ctx.fillStyle = '#0e1520';
      ctx.fillRect(0, 0, cssW, cssH);

      const fix = worldToScreen(station.x, station.y);

      const fromPoly = clipHalfPlaneSquare(station, obs, 'FROM', VIEW_NM);
      const toPoly = clipHalfPlaneSquare(station, obs, 'TO', VIEW_NM);
      /** Fixed hues so halves do not change shade with OBS or aircraft position. */
      fillPolygonWorld(ctx, fromPoly, worldToScreen, 'rgba(118, 78, 52, 0.45)');
      fillPolygonWorld(ctx, toPoly, worldToScreen, 'rgba(42, 118, 210, 0.44)');

      ctx.strokeStyle = '#5ad8a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fix[0], fix[1], 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#12261f';
      ctx.fill();
      /* “VOR” below the fix (not over the ring); avoids overlap with radial pill when close to station. */
      ctx.fillStyle = '#8cf5c6';
      ctx.font = '600 11px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const vorTy = fix[1] + 12 + 4;
      ctx.strokeStyle = 'rgba(8, 14, 12, 0.92)';
      ctx.lineWidth = 3;
      ctx.strokeText('VOR', fix[0], vorTy);
      ctx.fillStyle = '#8cf5c6';
      ctx.fillText('VOR', fix[0], vorTy);

      const drawLineAngle = (deg: number, color: string, dash: number[] = [], lineWidth = 2) => {
        const rad = (deg * Math.PI) / 180;
        const len = VIEW_NM * NM_TO_PX * 1.2;
        const dx = Math.sin(rad) * len;
        const dy = -Math.cos(rad) * len;
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(fix[0] - dx, fix[1] - dy);
        ctx.lineTo(fix[0] + dx, fix[1] + dy);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      for (const deg of CARDINAL_RADIALS) {
        drawLineAngle(deg, 'rgba(120, 145, 185, 0.34)', [], 1.35);
      }

      const labelDistNm = VIEW_NM - 1.05;
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const deg of CARDINAL_RADIALS) {
        const rad = (deg * Math.PI) / 180;
        const wx = station.x + Math.sin(rad) * labelDistNm;
        const wy = station.y + Math.cos(rad) * labelDistNm;
        const [sx, sy] = worldToScreen(wx, wy);
        const txt = deg === 0 ? '360' : deg.toString().padStart(3, '0');
        ctx.strokeStyle = 'rgba(10, 15, 25, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(txt, sx, sy);
        ctx.fillStyle = 'rgba(185, 205, 230, 0.94)';
        ctx.fillText(txt, sx, sy);
      }

      /*
       * TO/FROM hemisphere boundary only (perpendicular to OBS through VOR).
       * No separate OBS course line on the map — students use the instrument for OBS; this line shows the split.
       */
      drawLineAngle(obs + 90, 'rgba(255, 250, 228, 0.82)', [10, 7], 3);

      /* Large hemisphere labels — rotate with OBS (brown = FROM, blue = TO). */
      const obsRadLbl = (obs * Math.PI) / 180;
      const oxLbl = Math.sin(obsRadLbl);
      const oyLbl = Math.cos(obsRadLbl);
      const hemLblNm = VIEW_NM * 0.46;
      const [fromLblSx, fromLblSy] = worldToScreen(
        station.x + oxLbl * hemLblNm,
        station.y + oyLbl * hemLblNm
      );
      const [toLblSx, toLblSy] = worldToScreen(
        station.x - oxLbl * hemLblNm,
        station.y - oyLbl * hemLblNm
      );
      ctx.font = '800 16px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(12, 14, 22, 0.9)';
      ctx.strokeText('FROM', fromLblSx, fromLblSy);
      ctx.fillStyle = 'rgba(255, 235, 218, 0.97)';
      ctx.fillText('FROM', fromLblSx, fromLblSy);
      ctx.strokeText('TO', toLblSx, toLblSy);
      ctx.fillStyle = 'rgba(210, 232, 255, 0.97)';
      ctx.fillText('TO', toLblSx, toLblSy);

      if (interceptRadial !== undefined) {
        drawLineAngle(
          interceptRadial,
          'rgba(150, 115, 220, 0.65)',
          [6, 5],
          2
        );
      }

      if (failToFromFlag && trainingRadialLineDeg !== undefined) {
        drawLineAngle(trainingRadialLineDeg, 'rgba(255, 214, 128, 0.92)', [], 2.75);
      }

      /** Position radial: one ray from VOR along bearing toward aircraft only (no line through opposite side). */
      if (!hideMainAircraft) {
      const distAcForRay = distanceNm(station, aircraft);
      {
        const radH = (radial * Math.PI) / 180;
        const ux = Math.sin(radH);
        const uy = Math.cos(radH);
        const maxLenNm = VIEW_NM * 1.18;
        const lenNm =
          distAcForRay < 0.02
            ? maxLenNm * 0.42
            : Math.min(maxLenNm, Math.max(distAcForRay * 1.18, 2.8));
        const [ex, ey] = worldToScreen(
          station.x + ux * lenNm,
          station.y + uy * lenNm
        );
        ctx.beginPath();
        ctx.moveTo(fix[0], fix[1]);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = 'rgba(255, 145, 72, 0.92)';
        ctx.lineWidth = 2.85;
        ctx.stroke();
        const labelAlongRay = lenNm * 0.5;
        const [rlx, rly] = worldToScreen(
          station.x + ux * labelAlongRay,
          station.y + uy * labelAlongRay
        );
        const rayLbl = `R-${formatRadialDigits(radial)}°`;
        ctx.font = '700 12px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(8, 10, 14, 0.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(rayLbl, rlx, rly);
        ctx.fillStyle = 'rgba(255, 200, 130, 0.98)';
        ctx.fillText(rayLbl, rlx, rly);
      }
      }

      const ac = worldToScreen(aircraft.x, aircraft.y);

      function drawAircraftSymbol(params: {
        pos: Position;
        headingDeg: number;
        style: 'MAIN' | 'A' | 'B';
        courseErrorDeg?: number;
      }) {
        const { pos, headingDeg, style, courseErrorDeg } = params;
        const p = worldToScreen(pos.x, pos.y);
        const hRad = (headingDeg * Math.PI) / 180;

        const palette =
          style === 'MAIN'
            ? {
                bodyTop: '#b9dbff',
                bodyMid: '#6aa4e6',
                bodyBot: '#2f5f9f',
                stroke: '#eaf4ff',
                trim: '#f8fbff',
                belly: '#173152',
                shadow: 'rgba(0, 0, 0, 0.5)',
              }
            : style === 'A'
              ? {
                  bodyTop: '#f0e4ff',
                  bodyMid: '#b188ff',
                  bodyBot: '#6940d4',
                  stroke: 'rgba(245, 235, 255, 0.95)',
                trim: '#f6ebff',
                belly: '#301a74',
                  shadow: 'rgba(0, 0, 0, 0.4)',
                }
              : {
                  bodyTop: '#ddffef',
                  bodyMid: '#67efb3',
                  bodyBot: '#1f9a64',
                  stroke: 'rgba(230, 255, 245, 0.95)',
                trim: '#ecfff5',
                belly: '#0c4f33',
                  shadow: 'rgba(0, 0, 0, 0.4)',
                };

        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(hRad);

        ctx.shadowColor = palette.shadow;
        ctx.shadowBlur = style === 'MAIN' ? 5 : 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 2;

        const bodyGrad = ctx.createLinearGradient(0, -28, 0, 15);
        bodyGrad.addColorStop(0, palette.bodyTop);
        bodyGrad.addColorStop(0.35, palette.bodyMid);
        bodyGrad.addColorStop(1, palette.bodyBot);

        ctx.beginPath();
        ctx.moveTo(0, -27);
        ctx.quadraticCurveTo(4.5, -22, 6.5, -14);
        ctx.lineTo(26, -7);
        ctx.quadraticCurveTo(28.5, 0, 26, 7);
        ctx.lineTo(9, 11);
        ctx.lineTo(12.5, 16.5);
        ctx.quadraticCurveTo(6.5, 15.5, 0, 14.2);
        ctx.quadraticCurveTo(-6.5, 15.5, -12.5, 16.5);
        ctx.lineTo(-9, 11);
        ctx.lineTo(-26, 7);
        ctx.quadraticCurveTo(-28.5, 0, -26, -7);
        ctx.lineTo(-6.5, -14);
        ctx.quadraticCurveTo(-4.5, -22, 0, -27);
        ctx.closePath();

        ctx.fillStyle = bodyGrad;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.strokeStyle = palette.stroke;
        ctx.lineWidth = style === 'MAIN' ? 1.85 : 2.05;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Fuselage center trim gives more "aircraft" depth at all zoom sizes.
        ctx.strokeStyle = palette.trim;
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(0, -22);
        ctx.lineTo(0, 12);
        ctx.stroke();

        // Dark belly accent separates wings/fuselage from map background.
        ctx.fillStyle = palette.belly;
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        ctx.moveTo(-9, 4);
        ctx.quadraticCurveTo(0, 8.8, 9, 4);
        ctx.quadraticCurveTo(0, 14, -9, 4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Cockpit bubble + tip light makes heading direction easier to read.
        ctx.fillStyle = 'rgba(15, 28, 48, 0.9)';
        ctx.beginPath();
        ctx.ellipse(0, -14, 3.6, 6.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.arc(0, -24, 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Accent: give A/B a dashed outline so it’s obvious they’re training aircraft.
        if (style !== 'MAIN') {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(10, 14, 22, 0.55)';
          ctx.lineWidth = 1.35;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();

        // Label near the aircraft (not rotated).
        if (style !== 'MAIN') {
          ctx.font = '800 11px Plus Jakarta Sans, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const lbl = style === 'A' ? 'Aircraft A' : 'Aircraft B';
          ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)';
          ctx.lineWidth = 3;
          ctx.strokeText(lbl, p[0], p[1] - 26);
          ctx.fillStyle = style === 'A' ? 'rgba(232, 210, 255, 0.98)' : 'rgba(210, 255, 235, 0.98)';
          ctx.fillText(lbl, p[0], p[1] - 26);

          if (Number.isFinite(courseErrorDeg)) {
            const absErr = Math.abs(courseErrorDeg ?? 0);
            const fs = absErr >= 10;
            const side = (courseErrorDeg ?? 0) > 0 ? 'R' : (courseErrorDeg ?? 0) < 0 ? 'L' : 'C';
            const offText = fs
              ? `${absErr.toFixed(1)}° off (FS, ${side})`
              : `${absErr.toFixed(1)}° off (${side})`;
            ctx.font = '700 10px JetBrains Mono, monospace';
            ctx.textBaseline = 'top';
            ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)';
            ctx.lineWidth = 3;
            ctx.strokeText(offText, p[0], p[1] + 18);
            ctx.fillStyle = fs ? 'rgba(255, 210, 150, 0.98)' : 'rgba(225, 236, 252, 0.98)';
            ctx.fillText(offText, p[0], p[1] + 18);
          }
        }
      }

      /* Full-width intercept track: fly along this heading until the CDI centers on the target radial. */
      if (interceptHeading !== undefined) {
        const spanLen = VIEW_NM * NM_TO_PX * 1.2;
        const irad = (interceptHeading * Math.PI) / 180;
        const sdx = Math.sin(irad) * spanLen;
        const sdy = -Math.cos(irad) * spanLen;
        ctx.setLineDash([10, 6]);
        ctx.strokeStyle = 'rgba(220, 175, 255, 0.92)';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ac[0] - sdx, ac[1] - sdy);
        ctx.lineTo(ac[0] + sdx, ac[1] + sdy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';

        const lagNm = 4.2;
        const lwx = aircraft.x + Math.sin(irad) * lagNm;
        const lwy = aircraft.y + Math.cos(irad) * lagNm;
        const [lx, ly] = worldToScreen(lwx, lwy);
        const hdgTxt = `INT ${formatMagneticThreeDigit360(interceptHeading)}°`;
        const angTxt =
          interceptAngleDeg !== undefined
            ? `${Math.round(interceptAngleDeg)}° lead`
            : null;
        ctx.font = '700 11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(hdgTxt, lx, ly - (angTxt ? 7 : 0));
        ctx.fillStyle = 'rgba(232, 210, 255, 0.98)';
        ctx.fillText(hdgTxt, lx, ly - (angTxt ? 7 : 0));
        if (angTxt) {
          ctx.font = '600 9px JetBrains Mono, monospace';
          ctx.strokeText(angTxt, lx, ly + 8);
          ctx.fillStyle = 'rgba(200, 175, 230, 0.95)';
          ctx.fillText(angTxt, lx, ly + 8);
        }
      }

      if (interceptRadial !== undefined) {
        const tr = (interceptRadial * Math.PI) / 180;
        const tgx = station.x + Math.sin(tr) * (VIEW_NM - 1.2);
        const tgy = station.y + Math.cos(tr) * (VIEW_NM - 1.2);
        const [tsx, tsy] = worldToScreen(tgx, tgy);
        const tgt = formatRadialDigits(interceptRadial);
        const tgtLine = `TGT R-${tgt}°`;
        ctx.font = '600 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(10, 14, 22, 0.88)';
        ctx.lineWidth = 2.5;
        ctx.strokeText(tgtLine, tsx, tsy);
        ctx.fillStyle = 'rgba(190, 165, 245, 0.96)';
        ctx.fillText(tgtLine, tsx, tsy);
      }

      const trail = trailRef.current;
      if (trail.length > 1 && !hideMainAircraft) {
        ctx.strokeStyle = 'rgba(200,220,245,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [tx0, ty0] = worldToScreen(trail[0].x, trail[0].y);
        ctx.moveTo(tx0, ty0);
        for (let i = 1; i < trail.length; i++) {
          const [tx, ty] = worldToScreen(trail[i].x, trail[i].y);
          ctx.lineTo(tx, ty);
        }
        ctx.stroke();
      }

      // Draw training aircraft first; tether drawn again on top for visibility.
      if (extraAircraft?.length) {
        for (const ex of extraAircraft) {
          drawAircraftSymbol({
            pos: ex.aircraft,
            headingDeg: ex.heading,
            style: ex.id === 'A' ? 'A' : 'B',
            courseErrorDeg: ex.courseErrorDeg,
          });
        }
      }

      // A–B tether: on top of aircraft so it’s always visible; stretches when either is dragged.
      if (failToFromFlag && extraAircraft && extraAircraft.length >= 2) {
        const aEx = extraAircraft.find((e) => e.id === 'A');
        const bEx = extraAircraft.find((e) => e.id === 'B');
        if (aEx && bEx) {
          const [ax, ay] = worldToScreen(aEx.aircraft.x, aEx.aircraft.y);
          const [bx, by] = worldToScreen(bEx.aircraft.x, bEx.aircraft.y);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = 'rgba(14, 22, 36, 0.95)';
          ctx.lineWidth = 7;
          ctx.lineCap = 'round';
          ctx.setLineDash([16, 10]);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255, 220, 130, 0.98)';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = 'rgba(255, 200, 80, 0.75)';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (!hideMainAircraft) {
        drawAircraftSymbol({ pos: aircraft, headingDeg: heading, style: 'MAIN' });
      }

      /* R-###° + TO/FROM pill near aircraft (same radial as orange ray). */
      if (!hideMainAircraft) {
      const distAc = distanceNm(station, aircraft);
      const radRad = (radial * Math.PI) / 180;
      const labelAlongNm =
        distAc < 0.12
          ? 2.9
          : Math.min(Math.max(distAc * 0.52, 1.1), VIEW_NM - 0.75);
      let [rbx, rby] = worldToScreen(
        station.x + Math.sin(radRad) * labelAlongNm,
        station.y + Math.cos(radRad) * labelAlongNm
      );
      {
        const vx = rbx - fix[0];
        const vy = rby - fix[1];
        const d = Math.hypot(vx, vy);
        if (d < MIN_RADIAL_PILL_FROM_VOR_PX && d > 1e-3) {
          const s = MIN_RADIAL_PILL_FROM_VOR_PX / d;
          rbx = fix[0] + vx * s;
          rby = fix[1] + vy * s;
        } else if (d <= 1e-3) {
          rbx = fix[0];
          rby = fix[1] + MIN_RADIAL_PILL_FROM_VOR_PX;
        }
      }
      const radialDigits = formatRadialDigits(radial);
      const tfColor =
        toFrom === 'TO' ? 'rgba(165, 210, 255, 0.98)' : 'rgba(235, 185, 145, 0.98)';
      const rLabel = `R-${radialDigits}°`;
      const tfLabel = failToFromFlag ? 'TF FAIL' : toFrom;
      ctx.font = '700 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const m1 = ctx.measureText(rLabel);
      const m2 = ctx.measureText(tfLabel);
      const padX = 10;
      const pillW = Math.max(m1.width, m2.width) + padX * 2;
      const pillH = 34;
      const px = rbx - pillW / 2;
      const py = rby - pillH / 2;
      ctx.fillStyle = 'rgba(12, 20, 32, 0.92)';
      ctx.strokeStyle = 'rgba(255, 159, 67, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const rc = 8;
      ctx.moveTo(px + rc, py);
      ctx.lineTo(px + pillW - rc, py);
      ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + rc);
      ctx.lineTo(px + pillW, py + pillH - rc);
      ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - rc, py + pillH);
      ctx.lineTo(px + rc, py + pillH);
      ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - rc);
      ctx.lineTo(px, py + rc);
      ctx.quadraticCurveTo(px, py, px + rc, py);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const y1 = rby - 7;
      const y2 = rby + 7;
      ctx.strokeStyle = 'rgba(8, 12, 20, 0.88)';
      ctx.lineWidth = 3;
      ctx.strokeText(rLabel, rbx, y1);
      ctx.fillStyle = '#eaf4ff';
      ctx.fillText(rLabel, rbx, y1);
      ctx.strokeText(tfLabel, rbx, y2);
      ctx.fillStyle = failToFromFlag ? 'rgba(255, 210, 165, 0.98)' : tfColor;
      ctx.fillText(tfLabel, rbx, y2);

      const trk = (track * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(ac[0], ac[1]);
      ctx.lineTo(ac[0] + Math.sin(trk) * 40, ac[1] - Math.cos(trk) * 40);
      ctx.stroke();

      ctx.fillStyle = '#9eb5d6';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        `TRK ${Math.round(track).toString().padStart(3, '0')}°  ·  R-${radialDigits}°  ·  ${tfLabel}`,
        10,
        cssH - 12
      );
      }
    };

    paintRef.current = paint;
    paint();
    const ro = new ResizeObserver(() => requestAnimationFrame(() => paintRef.current?.()));
    if (host) ro.observe(host);
    else ro.observe(canvas);
    requestAnimationFrame(() => paintRef.current?.());
    return () => {
      paintRef.current = null;
      ro.disconnect();
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- scene lives in sceneRef; repaints via useLayoutEffect */
  }, []);

  const extraAircraftTetherSig =
    extraAircraft
      ?.map((e) => `${e.id}:${e.aircraft.x}:${e.aircraft.y}`)
      .join('|') ?? '';

  useLayoutEffect(() => {
    paintRef.current?.();
  }, [
    station.x,
    station.y,
    aircraft.x,
    aircraft.y,
    heading,
    track,
    radial,
    obs,
    toFrom,
    failToFromFlag,
    hideMainAircraft,
    trainingRadialLineDeg,
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
    extraAircraft,
    extraAircraftTetherSig,
  ]);

  const mapDraggable = Boolean(onMoveAircraft || onMoveExtraAircraft);

  return (
    <div className={`map-host ${mapDraggable ? 'map-host-draggable' : ''}`} ref={hostRef}>
      <canvas ref={canvasRef} className="map-canvas" />
      {!hideLegend && (
        <div className="map-legend">
          <span className="leg tf">
            brown FROM · blue TO · cream dashed: TO/FROM boundary (spins with OBS) · no OBS line
            on map
          </span>
          <span className="leg fan">gray: cardinal radials (360 / 090 / 180 / 270)</span>
          <span className="leg rad">
            orange: position radial — ray from VOR toward you with R-###°; pill shows R-###° and TO/FR
          </span>
          <span className="leg obs">OBS on instrument only — map shows boundary + fills</span>
          <span className="leg int">
            violet: target radial · bright violet: intercept heading — hidden when R-### matches the leg you picked
            (outbound = target; inbound = reciprocal)
          </span>
          {failToFromFlag && (
            <span className="leg rad">
              training: TO/FROM failed — map pill shows <strong>TF FAIL</strong>
            </span>
          )}
          {failToFromFlag && (
            <span className="leg rad">gold line: selected radial through both sides (Aircraft A/B sit on this line)</span>
          )}
          {onMoveAircraft && <span className="leg drag">drag airplane to reposition</span>}
        </div>
      )}
    </div>
  );
}
