"use client";

export function PirateBackground() {
  return (
    <div className="pirate-bg-stage" aria-hidden="true">
      {/* Drifting Clouds */}
      <img
        src="/pirate/images/cloud.svg"
        alt=""
        className="pirate-cloud pirate-cloud--1"
      />
      <img
        src="/pirate/images/cloud.svg"
        alt=""
        className="pirate-cloud pirate-cloud--2"
      />

      {/* Layer 3: Deep Background Waves */}
      <div
        className="pirate-wave pirate-waves--3"
        style={{ backgroundImage: "url('/pirate/images/waves-3.png')" }}
      />

      {/* Layer 2: Mid-level Waves */}
      <div
        className="pirate-wave pirate-waves--2"
        style={{ backgroundImage: "url('/pirate/images/waves-2.png')" }}
      />

      {/* Rocking Pirate Ship */}
      <div className="pirate-ship-wrapper">
        <img
          src="/pirate/images/pirate-ship.svg"
          alt="Pirate Agent Research Ship"
          className="pirate-ship"
        />
      </div>

      {/* Layer 1: Foreground Waves (front of ship hull) */}
      <div
        className="pirate-wave pirate-waves--1"
        style={{ backgroundImage: "url('/pirate/images/waves-1.png')" }}
      />
    </div>
  );
}
