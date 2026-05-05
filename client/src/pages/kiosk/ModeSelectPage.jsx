import { BarChart2, Camera, ChevronLeft } from "lucide-react";

export default function ModeSelectPage({ onSingleScan, onComparative, onBack }) {
  return (
    <div className="kiosk-page mode-select-page">
      <div className="mode-container">
        <h2 className="mode-heading">Select Mode</h2>
        <div className="mode-buttons">
          <button className="mode-card" onClick={onSingleScan}>
            <div className="mode-card-icon single"><Camera size={40} strokeWidth={1.5} /></div>
            <span className="mode-card-title">Single Scan</span>
            <span className="mode-card-desc">Capture and analyze one image</span>
          </button>
          <button className="mode-card" onClick={onComparative}>
            <div className="mode-card-icon comparative"><BarChart2 size={40} strokeWidth={1.5} /></div>
            <span className="mode-card-title">Comparative Analysis</span>
            <span className="mode-card-desc">Compare multiple captures</span>
          </button>
        </div>
        <button className="back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button>
      </div>
    </div>
  );
}
