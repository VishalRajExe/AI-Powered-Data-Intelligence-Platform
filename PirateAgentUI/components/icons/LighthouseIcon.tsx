import React from "react";

export function LighthouseIcon({
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
      {/* Lighthouse tower */}
      <path d="M7 21h10" />
      <path d="M8 21l2-13h4l2 13" fill="currentColor" fillOpacity="0.08" />
      {/* Stone bands */}
      <path d="M9 16h6" />
      <path d="M9.5 12h5" />
      {/* Lantern room gallery */}
      <path d="M8 8h8" />
      <path d="M9.5 8V5h5v3" />
      {/* Domed roof and finial */}
      <path d="M9.5 5a2.5 2.5 0 0 1 5 0" />
      {/* Light beams */}
      <path d="M4 6.5l3.5 1" strokeDasharray="1.5 1.5" />
      <path d="M20 6.5l-3.5 1" strokeDasharray="1.5 1.5" />
    </svg>
  );
}
