import React from "react";

export function NauticalInstrumentIcon({
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
      {/* Astrolabe / Sextant / Nautical dial */}
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.08" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="3" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="21" />
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
      {/* Pivot screws */}
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <path d="m17 7-3.5 3.5" />
    </svg>
  );
}
