import React from "react";

export function ShipWheelIcon({
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
      {/* Central hub */}
      <circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.2" />
      {/* Outer wheel ring */}
      <circle cx="12" cy="12" r="7" />
      {/* 8 Helm spokes & handles */}
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      {/* Diagonal spokes & handles */}
      <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" />
      <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" />
      <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" />
      <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" />
      {/* Spokes through to hub */}
      <line x1="12" y1="5" x2="12" y2="9.5" />
      <line x1="12" y1="14.5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="9.5" y2="12" />
      <line x1="14.5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
