"use client";

import { PirateNavbar } from "./PirateNavbar";
import { PirateHero } from "./PirateHero";
import { PirateBackground } from "./PirateBackground";

export function PirateLanding() {
  return (
    <div className="pirate-theme-root">
      <PirateNavbar />

      <main className="pirate-main">
        <section className="pirate-home" id="home">
          <PirateBackground />

          <div className="pirate-container">
            <PirateHero />
          </div>
        </section>
      </main>
    </div>
  );
}
