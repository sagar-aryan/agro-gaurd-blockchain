import React, { useEffect, useState } from 'react';
import footstepsTrail from './assets/animations/footsteps.svg';
import './StartupAnimation.css';

export default function StartupAnimation({ onComplete }) {
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setAnimating(false);
    }, 3600);

    const completeTimer = setTimeout(() => {
      onComplete();
    }, 4300);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div className={`startup-screen ${!animating ? 'fade-out' : ''}`}>
      <div className="startup-ink-cloud startup-ink-cloud-left" />
      <div className="startup-ink-cloud startup-ink-cloud-right" />

      <div className="map-panel">
        <span className="map-kicker">AGRO gaurd</span>
        <h1 className="map-quote">I solemnly swear that I am up to no good...</h1>
        <p className="map-subtitle">
          The herbology corridors are unfolding. Follow the footsteps into the living greenhouse dashboard.
        </p>

        <div className="footstep-lane">
          <img src={footstepsTrail} alt="" className="footsteps-trail" />
          <div className="compass-seal" aria-hidden="true">✦</div>
        </div>
      </div>
    </div>
  );
}
