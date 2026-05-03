import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Position } from '../types';
import {
  distanceNm,
  DME_EDIT_MIN_NM,
  MAP_PLAN_DME_MARGIN_NM,
  MAP_PLAN_VIEW_HALF_NM,
  MAP_VIEW_NM_TO_PX,
} from '../utils/vorMath';

/** Keep aircraft symbol and labels inside the canvas (pixels from each edge toward center). */
const MAP_EDGE_PAD_PX = 46;

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
  interceptRadial?: number;
  /** Recommended magnetic heading to fly for the intercept (full line drawn through aircraft). */
  interceptHeading?: number;
  /** Lead angle from Intercept panel — shown on map readout. */
  interceptAngleDeg?: number;
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
  interceptRadial,
  interceptHeading,
  interceptAngleDeg,
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
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
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
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
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
    if (!canvas || !onMoveAircraft) return;

    /* Center grab area — symbol spans ~±28 px */
    const HIT_PX = 52;
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

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = cw / 2;
      const cy = ch / 2;
      const ac = aircraftRef.current;
      const acx = cx + ac.x * NM_TO_PX;
      const acy = cy - ac.y * NM_TO_PX;
      const dx = px - acx;
      const dy = py - acy;
      if (dx * dx + dy * dy > HIT_PX * HIT_PX) return;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      onAircraftDragActive?.(true);
      onMoveAircraft(screenToWorld(px, py, cw, ch));
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      onMoveAircraft(screenToWorld(px, py, cw, ch));
    };

    const finishDrag = (e?: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
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
      onAircraftDragActive?.(false);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    canvas.addEventListener('lostpointercapture', onLostCapture);

    return () => {
      finishDrag();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', finishDrag);
      canvas.removeEventListener('pointercancel', finishDrag);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
    };
  }, [onMoveAircraft, onAircraftDragActive, planMapClampHalfNm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
        interceptRadial,
        interceptHeading,
        interceptAngleDeg,
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
      ctx.fillStyle = '#8cf5c6';
      ctx.font = '600 11px Plus Jakarta Sans, sans-serif';
      ctx.fillText('VOR', fix[0] - 12, fix[1] + 4);

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
      /** Position radial: bearing from station through the aircraft (same value as the VOR radial readout). */
      drawLineAngle(radial, 'rgba(255, 145, 72, 0.92)', [], 2.85);

      const ac = worldToScreen(aircraft.x, aircraft.y);

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
        const hdgTxt = `INT ${Math.round(interceptHeading).toString().padStart(3, '0')}°`;
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
      if (trail.length > 1) {
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

      const hRad = (heading * Math.PI) / 180;
      ctx.save();
      ctx.translate(ac[0], ac[1]);
      ctx.rotate(hRad);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;

      const bodyGrad = ctx.createLinearGradient(0, -28, 0, 15);
      bodyGrad.addColorStop(0, '#9ecfff');
      bodyGrad.addColorStop(0.35, '#5b93d4');
      bodyGrad.addColorStop(0.75, '#3d72b8');
      bodyGrad.addColorStop(1, '#2d5a96');

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

      ctx.strokeStyle = '#eaf4ff';
      ctx.lineWidth = 1.85;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(0, 11);
      ctx.stroke();

      ctx.fillStyle = 'rgba(15, 28, 48, 0.88)';
      ctx.beginPath();
      ctx.ellipse(0, -14, 3.8, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.arc(-26.5, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 0, 0, 0.45)';
      ctx.stroke();

      ctx.fillStyle = '#5dff9a';
      ctx.beginPath();
      ctx.arc(26.5, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 60, 30, 0.35)';
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(0, 13.5, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      /* Live radial label + TO/FROM words at radial pill. */
      const distAc = distanceNm(station, aircraft);
      const radRad = (radial * Math.PI) / 180;
      const labelAlongNm =
        distAc < 0.12
          ? 2.9
          : Math.min(Math.max(distAc * 0.52, 1.1), VIEW_NM - 0.75);
      const [rbx, rby] = worldToScreen(
        station.x + Math.sin(radRad) * labelAlongNm,
        station.y + Math.cos(radRad) * labelAlongNm
      );
      const radialDigits = formatRadialDigits(radial);
      const tfColor =
        toFrom === 'TO' ? 'rgba(165, 210, 255, 0.98)' : 'rgba(235, 185, 145, 0.98)';
      const rLabel = `R-${radialDigits}°`;
      ctx.font = '700 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const m1 = ctx.measureText(rLabel);
      const m2 = ctx.measureText(toFrom);
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
      ctx.strokeText(toFrom, rbx, y2);
      ctx.fillStyle = tfColor;
      ctx.fillText(toFrom, rbx, y2);

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
        `TRK ${Math.round(track).toString().padStart(3, '0')}°  ·  R-${radialDigits}°  ·  ${toFrom}`,
        10,
        cssH - 12
      );
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
    interceptRadial,
    interceptHeading,
    interceptAngleDeg,
  ]);

  return (
    <div
      className={`map-host ${onMoveAircraft ? 'map-host-draggable' : ''}`}
      ref={hostRef}
    >
      <canvas ref={canvasRef} className="map-canvas" />
      <div className="map-legend">
        <span className="leg tf">
          brown FROM · blue TO · cream dashed: TO/FROM boundary (spins with OBS) · no OBS line
          on map
        </span>
        <span className="leg fan">gray: cardinal radials (360 / 090 / 180 / 270)</span>
        <span className="leg rad">orange: your position radial (R-###° matches movement)</span>
        <span className="leg obs">OBS on instrument only — map shows boundary + fills</span>
        <span className="leg int">
          violet (through VOR): target radial · bright violet (through airplane): intercept heading to fly
        </span>
        {onMoveAircraft && <span className="leg drag">drag airplane to reposition</span>}
      </div>
    </div>
  );
}
