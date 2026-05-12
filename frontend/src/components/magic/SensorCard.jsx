import { motion } from 'framer-motion';

const Motion = motion;

export default function SensorCard({
  accent,
  delay = 0,
  detail,
  icon,
  label,
  onClick,
  unit,
  value,
}) {
  const IconComponent = icon;

  return (
    <Motion.button
      type="button"
      className="sensor-card section-card"
      onClick={onClick}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: 'easeOut' }}
    >
      <div className="sensor-card-header">
        <span className="sensor-card-icon" style={{ '--card-accent': accent }}>
          <IconComponent size={18} />
        </span>
        <span className="sensor-card-label">{label}</span>
      </div>

      <div className="sensor-card-reading">
        <span className="sensor-card-value">{value}</span>
        {unit ? <span className="sensor-card-unit">{unit}</span> : null}
      </div>

      <p className="sensor-card-detail">{detail}</p>
    </Motion.button>
  );
}
