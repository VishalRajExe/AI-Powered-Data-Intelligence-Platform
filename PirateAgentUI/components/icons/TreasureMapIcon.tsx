import React from "react";

export function TreasureMapIcon({
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
      {/* Folded map body */}
      <polygon
        points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
      {/* Waypoint route */}
      <path
        d="M6 14c2-2 3-1 5-3s2-2 4-1"
        strokeDasharray="2 2"
        strokeWidth={1.75}
      />
      {/* X marks the spot */}
      <path d="m16.5 8.5 2 2" />
      <path d="m18.5 8.5-2 2" />
    </svg>
  );
}
