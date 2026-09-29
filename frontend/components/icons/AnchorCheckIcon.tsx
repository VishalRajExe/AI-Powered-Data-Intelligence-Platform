import React from "react";

export function AnchorCheckIcon({
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
      {/* Anchor base */}
      <circle cx="9" cy="5" r="2.5" />
      <line x1="9" y1="21" x2="9" y2="7.5" />
      <path d="M4 11H2a7 7 0 0 0 10.5 6" />
      <line x1="4.5" y1="9" x2="13.5" y2="9" />
      {/* Checkmark badge */}
      <path d="m14 13 3 3 5-6" strokeWidth={2.5} />
    </svg>
  );
}
