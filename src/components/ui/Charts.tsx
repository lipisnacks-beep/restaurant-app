'use client';

import { useMemo } from 'react';

/* ------------------------------------------------------------------ */
/*  LineChart — multi-series trend over time. Pure SVG, no deps.       */
/* ------------------------------------------------------------------ */
export interface LineSeries {
  label: string;
  color: string;
  values: number[];
}
export interface LineChartProps {
  series: LineSeries[];
  labels: string[];
  height?: number;
  currency?: string;
}

export function LineChart({ series, labels, height = 240, currency = '₹' }: LineChartProps) {
  const width = 760;
  const padL = 56, padR = 16, padT = 16, padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const max = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((s) => s.values));
    // round up to a nice number
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / pow) * pow;
  }, [series]);

  const x = (i: number) => padL + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + plotH - f * plotH,
    val: f * max,
  }));

  // show at most ~8 x labels to avoid crowding
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 520 }}>
        {/* grid + y axis labels */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={width - padR} y2={g.y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {currency}{Math.round(g.val).toLocaleString('en-IN')}
            </text>
          </g>
        ))}
        {/* x labels */}
        {labels.map((lab, i) => (
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="#94a3b8">{lab}</text>
          ) : null
        ))}
        {/* series lines */}
        {series.map((s) => {
          if (s.values.length === 0) return null;
          const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="flex flex-wrap gap-4 justify-center mt-2 px-2">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DonutChart — category share breakdown. Pure SVG, no deps.          */
/* ------------------------------------------------------------------ */
const DONUT_COLORS = ['#f59e0b','#3b82f6','#10b981','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#06b6d4'];

export interface DonutSlice { label: string; value: number; }
export interface DonutChartProps {
  slices: DonutSlice[];
  currency?: string;
  centerLabel?: string;
}

export function DonutChart({ slices, currency = '₹', centerLabel }: DonutChartProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const size = 180, stroke = 28, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((s, i) => {
    const frac = total ? s.value / total : 0;
    const dash = frac * circ;
    const arc = {
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      dash, gap: circ - dash, offset: -offset, label: s.label, value: s.value, frac,
    };
    offset += dash;
    return arc;
  });

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-sm text-slate-400">
        <div className="w-[180px] h-[180px] rounded-full border-8 border-slate-100 flex items-center justify-center">
          <span className="text-xs">No data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg width={size} height={size} className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {arcs.map((a, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color}
            strokeWidth={stroke} strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={a.offset}
            transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="#64748b">{centerLabel || 'Total'}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#0f172a">
          {currency}{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5 w-full">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center justify-between text-sm gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.color }} />
              <span className="capitalize truncate text-slate-700">{a.label}</span>
            </span>
            <span className="text-slate-500 font-medium whitespace-nowrap">
              {currency}{a.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              <span className="text-slate-400 ml-1">({Math.round(a.frac * 100)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
