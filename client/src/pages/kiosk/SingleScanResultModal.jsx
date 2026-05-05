import { useEffect } from "react";
import { Maximize2 } from "lucide-react";
import ClassificationIcon from "../../components/ClassificationIcon";
import Checklist from "../../components/Checklist";
import { EC_TODO } from "./kioskConstants";

export default function SingleScanResultModal({ scan, onClose, onFullscreen }) {
  const diff = scan ? (Number(scan.temperature) - Number(scan.ambiance)).toFixed(1) : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop modal-backdrop-fullscreen" onClick={onClose}>
      <div className="single-scan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="single-modal-header">
          <h3>Scan Result</h3>
          <button className="mark-done-btn" onClick={onClose}>Mark as Done</button>
        </div>

        <div className="single-modal-body">
          <div className="single-modal-image-section">
            <div className="single-modal-image-wrap" onClick={onFullscreen}>
              <img src={scan.url} alt="Thermal scan" className="single-modal-image" />
              <div className="single-modal-expand"><Maximize2 size={18} /></div>
            </div>
          </div>

          <div className="single-modal-details-section">
            <div className="single-modal-classification single-modal-classification-large">
              <ClassificationIcon classification={scan.classification} size={18} />
              <span className={`scan-badge large ${scan.classification?.toLowerCase()}`}>
                {scan.classification}
              </span>
            </div>

            <div className="single-modal-readings">
              <div className="reading-item">
                <span className="reading-label">High Temp</span>
                <span className="reading-value">{scan.temperature}°C</span>
              </div>
              <div className="reading-item">
                <span className="reading-label">Ambient</span>
                <span className="reading-value">{scan.ambiance}°C</span>
              </div>
              <div className="reading-item highlight">
                <span className="reading-label">ΔT</span>
                <span className={`reading-value ${scan.classification?.toLowerCase()}`}>+{diff}°C</span>
              </div>
            </div>

            <div className="single-modal-timestamp">
              <span>Captured: {scan.timestamp}</span>
            </div>

            <div className="single-modal-recs">
              <h4>Recommended Actions</h4>
              <Checklist
                items={EC_TODO}
                storageKeyPrefix="single-scan"
                idKey={scan?.id ?? scan?.name ?? scan?.timestamp ?? "single"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
