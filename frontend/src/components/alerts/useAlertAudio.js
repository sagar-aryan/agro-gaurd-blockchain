import { useEffect, useRef } from 'react';
import { Howl, Howler } from 'howler';
import { FIRE_LOOP, MANDRAKE_WAIL, SPELL_CHIME } from '../../assets/sounds/soundLibrary';

Howler.autoUnlock = true;

function createSoundBank() {
  return {
    fire: new Howl({
      src: [FIRE_LOOP],
      loop: true,
      preload: true,
      volume: 0.22,
    }),
    intruder: new Howl({
      src: [SPELL_CHIME],
      preload: true,
      volume: 0.38,
    }),
    mandrake: new Howl({
      src: [MANDRAKE_WAIL],
      preload: true,
      volume: 0.34,
    }),
  };
}

export function useAlertAudio({ enabled, isFire, isIntruder, isLowMoisture }) {
  const soundsRef = useRef(null);
  const lastTriggeredRef = useRef({
    intruder: 0,
    mandrake: 0,
  });
  const previousFlagsRef = useRef({
    fire: false,
    intruder: false,
    lowMoisture: false,
  });

  if (soundsRef.current == null) {
    soundsRef.current = createSoundBank();
  }

  useEffect(() => {
    return () => {
      Object.values(soundsRef.current ?? {}).forEach((sound) => sound.unload());
    };
  }, []);

  useEffect(() => {
    const sounds = soundsRef.current;

    if (!sounds) {
      return;
    }

    if (!enabled) {
      sounds.fire.stop();
      previousFlagsRef.current = {
        fire: isFire,
        intruder: isIntruder,
        lowMoisture: isLowMoisture,
      };
      return;
    }

    if (isFire) {
      if (!sounds.fire.playing()) {
        sounds.fire.play();
      }
    } else if (sounds.fire.playing()) {
      sounds.fire.stop();
    }

    const now = Date.now();

    if (isIntruder && !previousFlagsRef.current.intruder && now - lastTriggeredRef.current.intruder > 1800) {
      sounds.intruder.stop();
      sounds.intruder.play();
      lastTriggeredRef.current.intruder = now;
    }

    if (isLowMoisture && !previousFlagsRef.current.lowMoisture && now - lastTriggeredRef.current.mandrake > 4500) {
      sounds.mandrake.stop();
      sounds.mandrake.play();
      lastTriggeredRef.current.mandrake = now;
    }

    previousFlagsRef.current = {
      fire: isFire,
      intruder: isIntruder,
      lowMoisture: isLowMoisture,
    };
  }, [enabled, isFire, isIntruder, isLowMoisture]);
}
