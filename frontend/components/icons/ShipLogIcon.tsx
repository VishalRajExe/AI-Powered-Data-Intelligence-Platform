import React from "react";

export function ShipLogIcon({
  className = "h-4 w-4",
  strokeWidth = 2,
  ...props
}: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Ship log / ledger book */}
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" fill="currentColor" fillOpacity="0.08" />
      <path d="M6 2v20" />
      {/* Ruled log entries */}
      <line x1="10" y1="7" x2="16" y2="7" />
      <line x1="10" y1="11" x2="17" y2="11" />
      <line x1="10" y1="15" x2="14" y2="15" />
      {/* Anchor bookmark stamp */}
      <circle cx="17.5" cy="16.5" r="1.5" />
    </svg>
  );
}
