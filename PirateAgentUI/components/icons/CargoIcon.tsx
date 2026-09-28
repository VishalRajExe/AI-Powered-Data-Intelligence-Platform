import React from "react";

export function CargoIcon({
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
      {/* 3D Isometric or structured Cargo crate */}
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" fill="currentColor" fillOpacity="0.08" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
      {/* Strapping / cargo banding detail */}
      <path d="m7.5 4.5 9 5" strokeDasharray="2 2" />
      <path d="M7.5 14.5v5" />
      <path d="M16.5 14.5v5" />
    </svg>
  );
}
