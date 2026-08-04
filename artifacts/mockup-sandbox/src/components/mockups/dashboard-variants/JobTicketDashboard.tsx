import { useMemo, useState } from "react";
import {
  Wrench,
  HardHat,
  ClipboardCheck,
  ChevronRight,
  Fuel,
  Gauge as GaugeIcon,
  Stamp,
} from "lucide-react";
import "./JobTicketDashboard.css";

// ─────────────────────────────────────────────────────────────────────────
// Mock data — stands in for the real store; shape mirrors the source app's
// computed financial fields but with organic, non-round numbers.
// ─────────────────────────────────────────────────────────────────────────

const WORKER = {
  name: "Marcus Whitfield",
  trade: "Journeyman Electrician · Local 349",
  ticketNo: "00482",
  payFrequency: "Bi-Weekly",
};

const LEDGER = [
  { label: "Gross Pay", value: 3842, kind: "in" as const },
  { label: "Take-Home Pay", value: 2917, kind: "in" as const },
  { label: "Rent & Utilities", value: -1350, kind: "out" as const },
  { label: "Truck Payment", value: -410, kind: "out" as const },
  { label: "Card Min. Payments", value: -186, kind: "out" as const },
  { label: "Free Cash Flow", value: 971, kind: "total" as const },
];

const GAUGES = [
  { label: "Emergency Fund", value: 2.4, max: 6, unit: "mo", danger: 1, warn: 3 },
  { label: "Debt-to-Income", value: 14, max: 40, unit: "%", danger: 30, warn: 20, invert: true },
  { label: "Credit Utilization", value: 38, max: 100, unit: "%", danger: 60, warn: 30, invert: true },
];

const PUNCH_LIST = [
  { id: "p1", label: "Build 3-month cushion", tip: "You're at 2.4 mo — $2,140 short of the 6-mo target.", done: false },
  { id: "p2", label: "Kill the 24.9% APR card", tip: "$1,860 balance is bleeding $38/mo in interest alone.", done: false },
  { id: "p3", label: "Start a Roth contribution", tip: "Even $50/check compounds hard by retirement.", done: true },
];

const TIME_CARD = [
  { id: "t1", employer: "Voltage Dynamics Inc.", date: "Jun 27", net: 1461, gross: 1921, punch: "OUT" },
  { id: "t2", employer: "Voltage Dynamics Inc.", date: "Jun 13", net: 1398, gross: 1832, punch: "OUT" },
  { id: "t3", employer: "Voltage Dynamics Inc.", date: "May 30", net: 1502, gross: 1988, punch: "OUT" },
];

const fmt = (n: number) =>
  n < 0
    ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// ─────────────────────────────────────────────────────────────────────────
// Inspection stamp — replaces the circular score ring with a rubber-stamp
// grade metaphor, in keeping with the work-order document concept.
// ─────────────────────────────────────────────────────────────────────────

function InspectionStamp({ score }: { score: number }) {
  const grade = score >= 70 ? "PASSED" : score >= 45 ? "CAUTION" : "REWORK";
  const color = score >= 70 ? "#4a6741" : score >= 45 ? "#c98a1f" : "#b3492b";

  return (
    <div className="jt-stamp flex-shrink-0" style={{ transform: "rotate(-9deg)" }}>
      <div
        className="relative w-[132px] h-[132px] rounded-full flex flex-col items-center justify-center"
        style={{
          border: `4px solid ${color}`,
          boxShadow: `inset 0 0 0 3px ${color}22`,
          color,
        }}
      >
        <div
          className="absolute inset-[6px] rounded-full"
          style={{ border: `1.5px dashed ${color}55` }}
        />
        <Stamp className="w-5 h-5 mb-0.5" strokeWidth={2.5} />
        <div className="text-4xl font-black leading-none jt-heading">{score}</div>
        <div className="jt-track text-[10px] font-bold mt-1">{grade}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pressure-gauge style meter — replaces linear progress bars.
// ─────────────────────────────────────────────────────────────────────────

function DialGauge({ g }: { g: (typeof GAUGES)[number] }) {
  const pct = Math.min(1, g.value / g.max);
  const angle = -90 + pct * 180;
  const dangerPct = g.danger / g.max;
  const warnPct = g.warn / g.max;

  let zoneColor = "#4a6741";
  if (g.invert) {
    if (pct >= dangerPct) zoneColor = "#b3492b";
    else if (pct >= warnPct) zoneColor = "#c98a1f";
  } else {
    if (pct <= dangerPct) zoneColor = "#b3492b";
    else if (pct <= warnPct) zoneColor = "#c98a1f";
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="92" height="58" viewBox="0 0 92 58">
        <path d="M 8 50 A 38 38 0 0 1 84 50" fill="none" stroke="#2b262022" strokeWidth="8" strokeLinecap="round" />
        <path
          d="M 8 50 A 38 38 0 0 1 84 50"
          fill="none"
          stroke={zoneColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${pct * 119.4} 119.4`}
        />
        <line
          x1="46" y1="50"
          x2={46 + 30 * Math.cos((angle * Math.PI) / 180)}
          y2={50 + 30 * Math.sin((angle * Math.PI) / 180)}
          stroke="#2b2620" strokeWidth="2.5" strokeLinecap="round"
        />
        <circle cx="46" cy="50" r="4" fill="#2b2620" />
      </svg>
      <div className="text-center -mt-1">
        <div className="jt-heading font-bold text-sm" style={{ color: zoneColor }}>
          {g.value}{g.unit}
        </div>
        <div className="jt-track text-[9px] uppercase text-[#2b2620]/60">{g.label}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function JobTicketDashboard() {
  const [punches, setPunches] = useState(PUNCH_LIST);
  const score = 58;

  const togglePunch = (id: string) => {
    setPunches((prev) => prev.map((p) => (p.id === id ? { ...p, done: !p.done } : p)));
  };

  const doneCount = useMemo(() => punches.filter((p) => p.done).length, [punches]);

  return (
    <div className="jt-root min-h-[100dvh] w-full py-8 px-4 md:px-8">
      <div className="max-w-3xl mx-auto">
        {/* ── Ticket header ───────────────────────────────────────────── */}
        <div
          className="relative bg-[#f4ecd4] rounded-t-md border-2 border-[#2b2620] px-5 py-4 md:px-7 md:py-5"
          style={{ boxShadow: "5px 5px 0 rgba(43,38,32,0.18)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#2b2620] flex items-center justify-center flex-shrink-0">
                <HardHat className="w-6 h-6 text-[#e7dfc7]" strokeWidth={2} />
              </div>
              <div>
                <div className="jt-track text-[10px] font-bold text-[#b3492b] uppercase">Financial Work Order</div>
                <h1 className="jt-heading text-2xl md:text-3xl font-bold text-[#2b2620] leading-tight">
                  {WORKER.name}
                </h1>
                <div className="text-xs text-[#2b2620]/70 mt-0.5">{WORKER.trade}</div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="jt-track text-[9px] text-[#2b2620]/50 uppercase">Ticket No.</div>
              <div className="jt-heading text-xl font-bold text-[#2b2620]">#{WORKER.ticketNo}</div>
              <div className="text-[10px] text-[#2b2620]/60 mt-1">{WORKER.payFrequency} cycle</div>
            </div>
          </div>
        </div>

        {/* ── Stamp + ledger panel ────────────────────────────────────── */}
        <div className="jt-perforation bg-[#f4ecd4] border-x-2 border-[#2b2620] px-5 md:px-7 py-6 flex flex-col sm:flex-row gap-6 items-center sm:items-start">
          <InspectionStamp score={score} />
          <div className="flex-1 w-full">
            <div className="jt-track text-[10px] font-bold text-[#2b2620]/50 uppercase mb-2">
              Pay Period Itemization
            </div>
            <div className="space-y-1.5">
              {LEDGER.map((row) => (
                <div
                  key={row.label}
                  className={`flex items-baseline gap-2 text-sm ${
                    row.kind === "total" ? "pt-2 mt-1 border-t-2 border-dashed border-[#2b2620]/30" : ""
                  }`}
                >
                  <span className={row.kind === "total" ? "jt-heading font-bold" : ""}>{row.label}</span>
                  <span className="flex-1 border-b border-dotted border-[#2b2620]/35 translate-y-[-3px]" />
                  <span
                    className={`font-bold tabular-nums ${
                      row.kind === "total"
                        ? "text-[#4a6741] text-base"
                        : row.kind === "out"
                        ? "text-[#b3492b]"
                        : "text-[#2b2620]"
                    }`}
                  >
                    {fmt(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Gauges panel ─────────────────────────────────────────────── */}
        <div className="jt-perforation bg-[#f4ecd4] border-x-2 border-[#2b2620] px-5 md:px-7 py-6">
          <div className="jt-track text-[10px] font-bold text-[#2b2620]/50 uppercase mb-4 flex items-center gap-1.5">
            <GaugeIcon className="w-3.5 h-3.5" /> Instrument Panel
          </div>
          <div className="grid grid-cols-3 gap-3">
            {GAUGES.map((g) => (
              <DialGauge key={g.label} g={g} />
            ))}
          </div>
        </div>

        {/* ── Punch list ───────────────────────────────────────────────── */}
        <div className="jt-perforation bg-[#f4ecd4] border-x-2 border-[#2b2620] px-5 md:px-7 py-6">
          <div className="flex items-center justify-between mb-3">
            <div className="jt-track text-[10px] font-bold text-[#2b2620]/50 uppercase flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5" /> Punch List — Next Moves
            </div>
            <div className="jt-heading text-xs font-bold text-[#2b2620]/60">
              {doneCount}/{punches.length} CLEARED
            </div>
          </div>
          <ul className="space-y-2.5">
            {punches.map((p) => (
              <li
                key={p.id}
                className="jt-rise flex items-start gap-3 cursor-pointer group"
                onClick={() => togglePunch(p.id)}
              >
                <button
                  aria-label={p.done ? "Mark incomplete" : "Mark complete"}
                  className="jt-checkbox mt-0.5"
                  style={{
                    backgroundColor: p.done ? "#4a6741" : "transparent",
                    borderColor: p.done ? "#4a6741" : "#2b2620",
                  }}
                >
                  {p.done && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                      <path d="M1 5L4.5 8.5L11 1.5" stroke="#f4ecd4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div className={p.done ? "opacity-45" : ""}>
                  <div
                    className={`text-sm font-bold jt-heading ${p.done ? "line-through decoration-2" : ""}`}
                  >
                    {p.label}
                  </div>
                  <div className="text-xs text-[#2b2620]/65 mt-0.5">{p.tip}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Time card / recent paystubs ─────────────────────────────── */}
        <div className="jt-perforation bg-[#f4ecd4] border-x-2 border-b-2 border-[#2b2620] rounded-b-md px-5 md:px-7 py-6"
             style={{ boxShadow: "5px 5px 0 rgba(43,38,32,0.18)" }}>
          <div className="jt-track text-[10px] font-bold text-[#2b2620]/50 uppercase mb-3 flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Time Card — Recent Punches
          </div>
          <div className="jt-scrollbar overflow-x-auto">
            <div className="flex gap-3 min-w-max pb-1">
              {TIME_CARD.map((t) => (
                <div
                  key={t.id}
                  className="jt-stub w-40 flex-shrink-0 bg-[#e7dfc7] border-2 border-[#2b2620] rounded-sm p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="jt-track text-[8px] font-bold text-[#2b2620]/50 uppercase">Stub</span>
                    <span
                      className="jt-track text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-sm"
                      style={{ backgroundColor: "#4a674122", color: "#4a6741" }}
                    >
                      {t.punch}
                    </span>
                  </div>
                  <div className="text-[11px] font-bold mt-1.5 leading-tight truncate">{t.employer}</div>
                  <div className="text-[10px] text-[#2b2620]/55 mb-2">{t.date}</div>
                  <div className="border-t border-dashed border-[#2b2620]/30 pt-1.5">
                    <div className="jt-heading text-lg font-bold text-[#4a6741]">{fmt(t.net)}</div>
                    <div className="text-[9px] text-[#2b2620]/50">{fmt(t.gross)} gross</div>
                  </div>
                </div>
              ))}
              <button className="w-40 flex-shrink-0 border-2 border-dashed border-[#2b2620]/40 rounded-sm p-3 flex flex-col items-center justify-center gap-1.5 text-[#2b2620]/60 hover:text-[#2b2620] hover:border-[#2b2620] transition-colors">
                <span className="text-xs font-bold jt-heading">View All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="jt-track text-center text-[9px] text-[#2b2620]/45 uppercase mt-4">
          Fuel Level: Free Cash Flow · <Fuel className="w-3 h-3 inline -mt-0.5" /> Refuel monthly
        </div>
      </div>
    </div>
  );
}
