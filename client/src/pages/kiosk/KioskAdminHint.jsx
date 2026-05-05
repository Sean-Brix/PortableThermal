import { useRef, useState } from "react";
import { Settings } from "lucide-react";
import { HOLD_DURATION_MS } from "./kioskConstants";

export default function KioskAdminHint({ onPress }) {
  const timerRef = useRef(null);
  const rafRef   = useRef(null);
  const startRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const startPress = (e) => {
    e.preventDefault();
    startRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setProgress(0);
        onPress();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const cancelPress = () => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    setProgress(0);
  };

  const circumference = 2 * Math.PI * 14;
  const dashOffset    = circumference * (1 - progress / 100);

  return (
    <button
      className="kiosk-admin-hint"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      aria-label="Admin access"
    >
      <Settings size={14} />
      {progress > 0 && (
        <svg className="kiosk-hint-ring" viewBox="0 0 32 32">
          <circle
            cx="16" cy="16" r="14"
            fill="none"
            stroke="rgba(25,184,122,0.7)"
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 16 16)"
          />
        </svg>
      )}
    </button>
  );
}
