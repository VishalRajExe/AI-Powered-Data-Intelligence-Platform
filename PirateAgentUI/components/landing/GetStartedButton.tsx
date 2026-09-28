"use client";

import Link from "next/link";

interface GetStartedButtonProps {
  size?: "default" | "nav";
  className?: string;
}

export function GetStartedButton({ size = "default", className = "" }: GetStartedButtonProps) {
  return (
    <Link
      href="/login"
      id="get-started-cta"
      className={`pirate-button ${size === "nav" ? "pirate-button--nav" : ""} ${className}`}
      aria-label="Get Started with PirateAgent"
    >
      <span className="pirate-button__inner">
        <span className="pirate-button__text">GET STARTED</span>
      </span>
    </Link>
  );
}
