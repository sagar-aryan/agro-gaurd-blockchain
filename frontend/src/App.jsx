import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Settings, X, Cpu, Send, RefreshCw, Activity, Droplets, Thermometer, Wind, Power } from 'lucide-react';
import { AnimatePresence, LazyMotion, domAnimation, motion } from 'framer-motion';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import StartupAnimation from './StartupAnimation';
import SensorCard from './components/magic/SensorCard';
import WelcomeBanner from './components/magic/WelcomeBanner';
import { useAlertAudio } from './components/alerts/useAlertAudio';

const AlertStage = lazy(() => import('./components/alerts/AlertStage'));
const Motion = motion;

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.10:8000';
const ALERTS_WS_URL = import.meta.env.VITE_ALERTS_WS_URL || `${BACKEND_URL.replace(/^http/, 'ws')}/ws/alerts`;
const RAW_SOIL_THRESHOLD = Number(import.meta.env.VITE_SOIL_THRESHOLD);
const SOIL_THRESHOLD = Number.isFinite(RAW_SOIL_THRESHOLD) ? RAW_SOIL_THRESHOLD : 35;

const HISTORY_META = {
  temperature: {
    accent: '#F28B57',
    fill: 'rgba(242, 139, 87, 0.18)',
    label: 'Temperature',
  },
  humidity: {
    accent: '#5AA1F6',
    fill: 'rgba(90, 161, 246, 0.18)',
    label: 'Humidity',
  },
  moisture: {
    accent: '#8FBF5A',
    fill: 'rgba(143, 191, 90, 0.18)',
    label: 'Soil Moisture',
  },
  ph: {
    accent: '#D4AF37',
    fill: 'rgba(212, 175, 55, 0.18)',
    label: 'pH',
  },
};

function normalizeSensorData(data = {}) {
  const temp = data.temp ?? data.temperature ?? 'N/A';
  const hum = data.hum ?? data.humidity ?? 'N/A';
  const soil = data.soil ?? data.moisture ?? 'N/A';
  const ph = data.ph ?? 'N/A';
  const fire = Number(data.fire ?? 0);

  return {
    fire,
    hum,
    humidity: hum,
    moisture: soil,
    ph,
    soil,
    temp,
    temperature: temp,
  };
}

function formatReading(value, digits = 1) {
  if (value === 'N/A' || value === null || value === undefined || value === '') {
    return '--';
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  return numericValue.toFixed(digits);
}

function toNumericValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export default function App() {
  const [showAnimation, setShowAnimation] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [isFire, setIsFire] = useState(false);
  const [isIntruder, setIsIntruder] = useState(false);

  const [sensors, setSensors] = useState(() => normalizeSensorData());
  const [relayState, setRelayState] = useState(0);

  const [chartModal, setChartModal] = useState({ isOpen: false, feedName: null, data: [] });
  const [isChartLoading, setIsChartLoading] = useState(false);

  const [chatHistory, setChatHistory] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);

  const [pan, setPan] = useState(90);
  const [tilt, setTilt] = useState(90);

  const [showMobileModal, setShowMobileModal] = useState(false);
  const [mobileData, setMobileData] = useState([]);

  const reconnectTimeout = useRef(null);

  const soilValue = toNumericValue(sensors.soil);
  const isLowMoisture = soilValue !== null && soilValue < SOIL_THRESHOLD;

  useAlertAudio({
    enabled: !showAnimation,
    isFire,
    isIntruder,
    isLowMoisture,
  });

  useEffect(() => {
    if (showAnimation) {
      return undefined;
    }

    let ws;

    const connectWS = () => {
      ws = new WebSocket(ALERTS_WS_URL);

      ws.onmessage = (event) => {
        const msg = event.data;

        if (msg === 'FIRE_ALERT') {
          setIsFire(true);
        } else if (msg === 'FIRE_SAFE') {
          setIsFire(false);
        } else if (msg === 'INTRUDER_ALERT') {
          setIsIntruder(true);
        } else if (msg === 'INTRUDER_SAFE') {
          setIsIntruder(false);
        }
      };

      ws.onclose = () => {
        reconnectTimeout.current = setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        ws.close();
      }

      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [showAnimation]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.body.className = `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    if (showAnimation) {
      return undefined;
    }

    const fetchLiveSensors = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/sensors/live`);

        if (res.ok) {
          const data = await res.json();
          setSensors(normalizeSensorData(data));
        }
      } catch (error) {
        console.error('Live sensors fetch error', error);
      }
    };

    fetchLiveSensors();
    const intervalId = setInterval(fetchLiveSensors, 5000);

    return () => clearInterval(intervalId);
  }, [showAnimation]);

  const handleCameraControl = async (axis, value) => {
    try {
      await fetch(`${BACKEND_URL}/api/control/camera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [axis]: value }),
      });
    } catch (error) {
      console.error('Error setting camera:', error);
    }
  };

  const handleRelayToggle = async () => {
    const newState = relayState === 0 ? 1 : 0;
    setRelayState(newState);

    try {
      await fetch(`${BACKEND_URL}/api/control/relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay: newState }),
      });
    } catch (error) {
      console.error('Error setting relay state:', error);
    }
  };

  const handleSendChat = async () => {
    if (!prompt.trim()) {
      return;
    }

    const newHistory = [...chatHistory, { role: 'user', content: prompt }];
    setChatHistory(newHistory);

    const currentPrompt = prompt;
    setPrompt('');
    setIsChatSubmitting(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentPrompt,
          chat_history: chatHistory,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setChatHistory((previousHistory) => [
          ...previousHistory,
          { role: 'assistant', content: `**Backend Error**: ${data.detail || 'Unknown server error'}` },
        ]);
        return;
      }

      setChatHistory((previousHistory) => [
        ...previousHistory,
        { role: 'assistant', content: data.reply || 'Error fetching reply' },
      ]);
    } catch (error) {
      console.error(error);
      setChatHistory((previousHistory) => [
        ...previousHistory,
        { role: 'assistant', content: `**Network Error**: Unable to reach AI agent. ${error.message}` },
      ]);
    } finally {
      setIsChatSubmitting(false);
    }
  };

  const openChart = async (feedName) => {
    setChartModal({ isOpen: true, feedName, data: [] });
    setIsChartLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/sensors/history/${feedName}`);

      if (res.ok) {
        const data = await res.json();
        setChartModal({ isOpen: true, feedName, data });
      }
    } catch (error) {
      console.error('Fetch history error', error);
    } finally {
      setIsChartLoading(false);
    }
  };

  const fetchMobileData = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/mobile/latest`);

      if (res.ok) {
        const data = await res.json();
        setMobileData(data);
        setShowMobileModal(true);
      }
    } catch (error) {
      console.error(error);
    }
  };

  if (showAnimation) {
    return <StartupAnimation onComplete={() => setShowAnimation(false)} />;
  }

  const chartMeta = HISTORY_META[chartModal.feedName] ?? HISTORY_META.temperature;
  const chartData = {
    labels: chartModal.data.map((entry) => {
      const date = new Date(entry.time * 1000);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }),
    datasets: [
      {
        label: `${chartMeta.label} - past 24 hours`,
        data: chartModal.data.map((entry) => entry.value),
        borderColor: chartMeta.accent,
        backgroundColor: chartMeta.fill,
        fill: true,
        tension: 0.35,
      },
    ],
  };

  const chartOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#ead9a1',
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(212, 175, 55, 0.15)',
        },
        ticks: {
          color: '#d8c694',
        },
      },
      y: {
        grid: {
          color: 'rgba(212, 175, 55, 0.15)',
        },
        ticks: {
          color: '#d8c694',
        },
      },
    },
  };

  const sensorCards = [
    {
      accent: '#F28B57',
      detail: 'Tap for the last 24 hours of greenhouse heat readings.',
      digits: 1,
      historyKey: 'temperature',
      icon: Thermometer,
      key: 'temp',
      label: 'Temperature',
      unit: '°C',
    },
    {
      accent: '#5AA1F6',
      detail: 'Current atmospheric moisture from the existing live telemetry feed.',
      digits: 0,
      historyKey: 'humidity',
      icon: Wind,
      key: 'hum',
      label: 'Humidity',
      unit: '%',
    },
    {
      accent: '#8FBF5A',
      detail: 'Soil moisture normalized from the current dashboard data shape.',
      digits: 0,
      historyKey: 'moisture',
      icon: Activity,
      key: 'soil',
      label: 'Soil Moisture',
      unit: '%',
    },
    {
      accent: '#D4AF37',
      detail: 'pH value from the same sensor payload used by the existing UI.',
      digits: 1,
      historyKey: 'ph',
      icon: Droplets,
      key: 'ph',
      label: 'pH',
      unit: '',
    },
  ];

  return (
    <LazyMotion features={domAnimation}>
      <div className={`app-shell theme-${theme} ${isFire ? 'danger-fire' : ''}`}>
        <div className="app-atmosphere" aria-hidden="true">
          <div className="atmosphere-glow atmosphere-glow-gold" />
          <div className="atmosphere-glow atmosphere-glow-red" />
          <div className="atmosphere-glow atmosphere-glow-green" />
        </div>

        <Suspense fallback={null}>
          <AlertStage
            isFire={isFire}
            isIntruder={isIntruder}
            isLowMoisture={isLowMoisture}
            lowMoistureThreshold={SOIL_THRESHOLD}
          />
        </Suspense>

        <div className="page-frame">
          <Motion.header
            className="app-header"
            initial={{ opacity: 0, y: -22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <div className="brand-panel">
              <div className="brand-seal">AG</div>
              <div className="brand-copy">
                <span className="brand-caption">Enchanted crop monitoring</span>
                <h1 className="brand-title">AGRO gaurd</h1>
                <p className="brand-subtitle">
                  A magical interface layered on top of the existing greenhouse camera, alerts, and controls.
                </p>
              </div>
            </div>

            <div className="header-actions">
              <button
                type="button"
                className="theme-switch"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                Switch to {theme === 'dark' ? 'Moonlit Parchment' : 'Midnight Castle'}
              </button>

              <button type="button" className="icon-btn rune-button" onClick={() => setIsSettingsOpen(true)}>
                <Settings size={22} />
              </button>
            </div>
          </Motion.header>

          <main className="main-content">
            <WelcomeBanner soilValue={soilValue} threshold={SOIL_THRESHOLD} />

            <section className="observatory-layout">
              <Motion.section
                className="observatory-panel section-card"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
              >
                <div className="panel-heading">
                  <div>
                    <span className="section-eyebrow">Watchtower feed</span>
                    <h2>Enchanted greenhouse surveillance</h2>
                  </div>
                  <div className="video-overlay-status">
                    <span className="status-dot pulse" />
                    <span>Live edge AI ward</span>
                  </div>
                </div>

                <div className="camera-control-layout">
                  <div className="camera-primary-row">
                    <div className="video-card">
                      <img
                        src={`${BACKEND_URL}/api/video_feed`}
                        alt="AGRO gaurd greenhouse surveillance stream"
                        className="crop-video"
                      />
                    </div>

                    <div className="slider-card slider-card-vertical">
                      <span className="slider-label">Vertical ward</span>
                      <Slider
                        vertical
                        min={0}
                        max={180}
                        defaultValue={90}
                        value={tilt}
                        onChange={(value) => setTilt(value)}
                        onChangeComplete={(value) => handleCameraControl('vertical', value)}
                        onAfterChange={(value) => handleCameraControl('vertical', value)}
                        trackStyle={{ backgroundColor: '#d4af37' }}
                        handleStyle={{ borderColor: '#d4af37', backgroundColor: '#f6edd0' }}
                      />
                    </div>
                  </div>

                  <div className="slider-card slider-card-horizontal">
                    <span className="slider-label">Horizontal ward</span>
                    <Slider
                      min={0}
                      max={180}
                      defaultValue={90}
                      value={pan}
                      onChange={(value) => setPan(value)}
                      onChangeComplete={(value) => handleCameraControl('horizontal', value)}
                      onAfterChange={(value) => handleCameraControl('horizontal', value)}
                      trackStyle={{ backgroundColor: '#d4af37' }}
                      handleStyle={{ borderColor: '#d4af37', backgroundColor: '#f6edd0' }}
                    />
                  </div>
                </div>

                <div className="panel-actions">
                  <button type="button" className="oracle-button" onClick={() => setIsChatOpen(true)}>
                    <Cpu size={18} />
                    Consult the Greenhouse Oracle
                  </button>
                </div>
              </Motion.section>

              <Motion.aside
                className="watch-panel section-card"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.16, ease: 'easeOut' }}
              >
                <div className="panel-heading">
                  <div>
                    <span className="section-eyebrow">Ward status</span>
                    <h2>Live alert runes</h2>
                  </div>
                </div>

                <div className="watch-grid">
                  <div className={`ward-card ${isFire ? 'is-alert' : ''}`}>
                    <span>Fire ward</span>
                    <strong>{isFire ? 'Dragonfire detected' : 'Calm embers'}</strong>
                    <small>Driven by the existing WebSocket message stream.</small>
                  </div>

                  <div className={`ward-card ${isIntruder ? 'is-intruder' : ''}`}>
                    <span>Intruder ward</span>
                    <strong>{isIntruder ? 'Castle breached' : 'Perimeter clear'}</strong>
                    <small>Still bound to the current `isIntruder` dashboard state.</small>
                  </div>

                  <div className={`ward-card ${isLowMoisture ? 'is-dry' : ''}`}>
                    <span>Root moisture</span>
                    <strong>{isLowMoisture ? 'Mandrake unrest' : 'Roots steady'}</strong>
                    <small>Threshold: {SOIL_THRESHOLD}% from `.env`.</small>
                  </div>
                </div>

                <div className="pump-card">
                  <div>
                    <span className="section-eyebrow">Irrigation relay</span>
                    <h3>Water Pump</h3>
                  </div>

                  <button type="button" className="pump-button" onClick={handleRelayToggle}>
                    <Power size={18} />
                    {relayState === 1 ? 'Pump Running' : 'Pump Off'}
                  </button>
                </div>

                <button type="button" className="secondary-button" onClick={fetchMobileData}>
                  View Mobile Node Ledger
                </button>
              </Motion.aside>
            </section>

            <section className="sensor-grid">
              {sensorCards.map((sensor, index) => (
                <SensorCard
                  key={sensor.key}
                  accent={sensor.accent}
                  delay={0.22 + (index * 0.06)}
                  detail={sensor.detail}
                  icon={sensor.icon}
                  label={sensor.label}
                  onClick={() => openChart(sensor.historyKey)}
                  unit={sensor.unit}
                  value={formatReading(sensors[sensor.key], sensor.digits)}
                />
              ))}
            </section>
          </main>

          <footer className="app-footer">
            <p>AGRO gaurd keeps the existing camera, sensor, chart, and alert logic intact while transforming the presentation layer.</p>
          </footer>
        </div>

        <AnimatePresence>
          {isSettingsOpen ? (
            <Motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
            >
              <Motion.div
                className="modal-card section-card"
                initial={{ opacity: 0, y: 26, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 26, scale: 0.96 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <span className="section-eyebrow">Preferences</span>
                    <h2>Castle settings</h2>
                  </div>
                  <button type="button" className="icon-btn rune-button" onClick={() => setIsSettingsOpen(false)}>
                    <X />
                  </button>
                </div>

                <div className="settings-row">
                  <span>Theme</span>
                  <button
                    type="button"
                    className="theme-switch"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    Switch to {theme === 'dark' ? 'Moonlit Parchment' : 'Midnight Castle'}
                  </button>
                </div>

                <p className="settings-note">
                  Only the UI layer changed. The existing WebSocket, sensor fetches, and control endpoints remain untouched.
                </p>
              </Motion.div>
            </Motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {isChatOpen ? (
            <Motion.div
              className="modal-overlay chat-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatOpen(false)}
            >
              <Motion.aside
                className="chat-panel section-card"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <span className="section-eyebrow">AI advisory</span>
                    <h3>The Greenhouse Oracle</h3>
                  </div>
                  <button type="button" className="icon-btn rune-button" onClick={() => setIsChatOpen(false)}>
                    <X />
                  </button>
                </div>

                <div className="chat-messages">
                  {chatHistory.length === 0 ? (
                    <div className="chat-empty">
                      Ask about crop health, the camera feed, or the existing edge system.
                    </div>
                  ) : null}

                  {chatHistory.map((message, index) => (
                    <div key={index} className={`chat-bubble ${message.role}`}>
                      <div
                        className="chat-bubble-content"
                        dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }}
                      />
                    </div>
                  ))}

                  {isChatSubmitting ? (
                    <div className="chat-bubble assistant typing">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  ) : null}
                </div>

                <div className="chat-input-area">
                  <input
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleSendChat()}
                    placeholder="Summon a diagnosis for the greenhouse..."
                    autoFocus
                  />
                  <button type="button" onClick={handleSendChat} disabled={isChatSubmitting || !prompt.trim()}>
                    <Send size={18} />
                  </button>
                </div>
              </Motion.aside>
            </Motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {showMobileModal ? (
            <Motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileModal(false)}
            >
              <Motion.div
                className="modal-card modal-card-wide section-card"
                initial={{ opacity: 0, y: 26, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 26, scale: 0.96 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <span className="section-eyebrow">Mobile node</span>
                    <h2>Latest field ledger</h2>
                  </div>
                  <button type="button" className="icon-btn rune-button" onClick={() => setShowMobileModal(false)}>
                    <X />
                  </button>
                </div>

                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Timestamp</th>
                        <th>M1</th>
                        <th>M2</th>
                        <th>M3</th>
                        <th>M4</th>
                        <th>Temp</th>
                        <th>Pressure</th>
                        <th>Lat</th>
                        <th>Lon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mobileData.map((row) => (
                        <tr key={row.id}>
                          <td>{row.id}</td>
                          <td>{row.timestamp}</td>
                          <td>{row.m1}</td>
                          <td>{row.m2}</td>
                          <td>{row.m3}</td>
                          <td>{row.m4}</td>
                          <td>{row.temp}</td>
                          <td>{row.pressure}</td>
                          <td>{row.lat}</td>
                          <td>{row.lon}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Motion.div>
            </Motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {chartModal.isOpen ? (
            <Motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChartModal({ isOpen: false, feedName: null, data: [] })}
            >
              <Motion.div
                className="modal-card modal-card-wide section-card"
                initial={{ opacity: 0, y: 26, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 26, scale: 0.96 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <span className="section-eyebrow">Historical reading</span>
                    <h2>{chartMeta.label} - 24 hour history</h2>
                  </div>
                  <button
                    type="button"
                    className="icon-btn rune-button"
                    onClick={() => setChartModal({ isOpen: false, feedName: null, data: [] })}
                  >
                    <X />
                  </button>
                </div>

                <div className="chart-shell">
                  {isChartLoading ? (
                    <div className="loading-state">
                      <RefreshCw className="spin" size={32} />
                    </div>
                  ) : (
                    <Line data={chartData} options={chartOptions} />
                  )}
                </div>
              </Motion.div>
            </Motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}
