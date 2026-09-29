"use client";

import { GetStartedButton } from "./GetStartedButton";

export function PirateHero() {
  return (
    <div className="pirate-hero-data">
      <h1 className="pirate-hero-title">
        <span>YOUR AI DATA</span>
        RESEARCH CREW
      </h1>

      <p className="pirate-hero-desc">
        Turn a simple business request into clean, structured,{" "}
        <span className="whitespace-nowrap">source-backed</span> web data.
      </p>

      <div className="pirate-hero-cta">
        <GetStartedButton />
      </div>
    </div>
  );
}
