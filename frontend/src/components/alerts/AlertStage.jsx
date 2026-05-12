import { AnimatePresence, motion } from 'framer-motion';
import dragonSigil from '../../assets/animations/dragon.svg';
import mandrakeSigil from '../../assets/animations/mandrake.svg';

const Motion = motion;

export default function AlertStage({ isFire, isIntruder, isLowMoisture, lowMoistureThreshold }) {
  return (
    <div className="alert-stage" aria-live="polite">
      <AnimatePresence>
        {isFire ? (
          <Motion.div
            key="fire-alert"
            className="alert-fire-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <Motion.img
              src={dragonSigil}
              alt=""
              className="alert-dragon"
              animate={{
                x: ['-6%', '6%', '-6%'],
                y: [0, -10, 0],
                rotate: [-3, 4, -3],
              }}
              transition={{
                duration: 6.5,
                ease: 'easeInOut',
                repeat: Infinity,
              }}
            />

            <Motion.div
              className="alert-fire-card"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <span className="alert-kicker">Fire Alert</span>
              <h2>Dragonfire in the greenhouse</h2>
              <p>Red wards are active while the existing edge pipeline resolves the event.</p>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isIntruder ? (
          <Motion.div
            key="intruder-alert"
            className="alert-intruder-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <Motion.div
              className="alert-intruder-flash"
              animate={{ opacity: [0.08, 0.35, 0.08] }}
              transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut' }}
            />
            <Motion.div
              className="alert-intruder-text"
              animate={{ y: [24, -10, 24], opacity: [0, 1, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              Piertotum Locomotor!
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isLowMoisture ? (
          <Motion.div
            key="moisture-alert"
            className="alert-mandrake-card"
            initial={{ opacity: 0, x: 28, y: 14, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, y: 18, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <Motion.img
              src={mandrakeSigil}
              alt=""
              className="alert-mandrake"
              animate={{ rotate: [0, -7, 6, -4, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="alert-mandrake-copy">
              <span className="alert-kicker">Low Moisture</span>
              <strong>Mandrake roots are screaming</strong>
              <p>Soil moisture dropped below the {lowMoistureThreshold}% threshold.</p>
            </div>
          </Motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
