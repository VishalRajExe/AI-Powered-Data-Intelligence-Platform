import React from "react";

export function HistoryScrollIcon({
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
      {/* Rolled parchment scroll */}
      <path d="M8 2h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z" fill="currentColor" fillOpacity="0.08" />
      <path d="M5 16a3 3 0 0 0 3 3h13" />
      <path d="M5 5a3 3 0 0 1 3-3" />
      {/* Clockwise history curl arrow or log lines */}
      <line x1="9" y1="7" x2="16" y2="7" />
      <line x1="9" y1="11" x2="17" y2="11" />
      <line x1="9" y1="15" x2="13" y2="15" />
    </svg>
  );
}
