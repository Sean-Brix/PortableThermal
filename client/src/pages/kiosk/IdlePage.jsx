import { ScanLine } from "lucide-react";

export default function IdlePage({ onTouch }) {
  return (
    <div className="kiosk-page idle-page" onClick={onTouch}>
      <div className="idle-scan-line" />
      <div className="idle-content">
        <div className="idle-icon-ring"><ScanLine size={48} strokeWidth={1.5} /></div>
        <h1 className="idle-title">Thermal Inspector</h1>
        <p className="idle-subtitle">Touch anywhere to begin</p>
        <div className="idle-pulse-ring" />
      </div>
    </div>
  );
}
