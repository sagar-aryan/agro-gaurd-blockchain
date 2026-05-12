import { useEffect, useState } from 'react';

export default function TypewriterText({ text, speed = 38 }) {
  const [visibleCharacters, setVisibleCharacters] = useState(0);

  useEffect(() => {
    let currentIndex = 0;
    const intervalId = window.setInterval(() => {
      currentIndex += 1;
      setVisibleCharacters(currentIndex);

      if (currentIndex >= text.length) {
        window.clearInterval(intervalId);
      }
    }, speed);

    return () => window.clearInterval(intervalId);
  }, [speed, text]);

  return (
    <span className="typewriter">
      {text.slice(0, visibleCharacters)}
      <span className={`typewriter-cursor ${visibleCharacters >= text.length ? 'is-idle' : ''}`}>|</span>
    </span>
  );
}
