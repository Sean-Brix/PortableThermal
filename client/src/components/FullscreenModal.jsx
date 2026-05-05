import { useEffect } from "react";
import { X } from "lucide-react";

export default function FullscreenModal({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fullscreen-modal" onClick={onClose}>
      <button className="fullscreen-close-btn" onClick={onClose}><X size={22} /></button>
      <img src={url} alt="Thermal scan fullscreen" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
