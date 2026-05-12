import { motion } from 'framer-motion';
import TypewriterText from './TypewriterText';

const Motion = motion;

function formatSoilStatus(soilValue, threshold) {
  if (soilValue === null) {
    return 'Awaiting the latest soil parchment from the greenhouse sensors.';
  }

  if (soilValue < threshold) {
    return `Mandrake roots are restless. Soil moisture slipped below ${threshold}%.`;
  }

  return `Root moisture is holding at ${soilValue.toFixed(0)}%, above the ${threshold}% warning threshold.`;
}

export default function WelcomeBanner({ soilValue, threshold }) {
  const isWarning = soilValue !== null && soilValue < threshold;

  return (
    <Motion.section
      className="welcome-banner section-card"
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="welcome-copy">
        <span className="section-eyebrow">AGRO gaurd Herbology Command</span>
        <h2 className="welcome-title">
          <TypewriterText text="Professor Sprout welcomes you to Herbology Class" />
        </h2>
        <p className="welcome-subtitle">
          A cinematic spell-layer over the existing camera, sensor, and control flows without changing how the greenhouse actually behaves.
        </p>

        <div className={`welcome-status ${isWarning ? 'is-warning' : ''}`}>
          <span className="welcome-status-label">Greenhouse note</span>
          <span>{formatSoilStatus(soilValue, threshold)}</span>
        </div>
      </div>

      <div className="welcome-garden" aria-hidden="true">
        <div className="plant plant-one">
          <span className="leaf leaf-left" />
          <span className="leaf leaf-right" />
        </div>
        <div className="plant plant-two">
          <span className="leaf leaf-left" />
          <span className="leaf leaf-right" />
        </div>
        <div className="plant plant-three">
          <span className="leaf leaf-left" />
          <span className="leaf leaf-right" />
        </div>
      </div>
    </Motion.section>
  );
}
