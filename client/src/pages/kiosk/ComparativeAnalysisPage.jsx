import { useState } from "react";
import { BarChart2, CheckCircle2, ChevronLeft } from "lucide-react";
import FullscreenModal from "../../components/FullscreenModal";
import ClassificationIcon from "../../components/ClassificationIcon";
import ComparativeAnalysisModal from "./ComparativeAnalysisModal";

export default function ComparativeAnalysisPage({ videoCallbackRef, isCameraReady, isSaving, status, error, scans, onCapture, onComplete, onBack }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [showAnalysis, setShowAnalysis]   = useState(false);

  const handleMarkComplete = async () => {
    await onComplete?.();
    setFullscreenUrl(null);
    setShowAnalysis(false);
  };

  return (
    <div className="scan-layout">
      <div className="scan-main">
        <div className="scan-video-wrapper">
          <video ref={videoCallbackRef} autoPlay muted playsInline className="scan-video" />
          {!isCameraReady && <div className="scan-no-camera">Camera unavailable</div>}
        </div>
        <div className="scan-footer">
          <button className="back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button>
          {(error || status) && (
            <span className={`scan-status-text ${error ? "is-error" : ""}`}>{error || status}</span>
          )}
        </div>
      </div>

      <aside className="scan-sidebar">
        <div className="sidebar-header">
          <span>Comparative</span>
          <span className="sidebar-count">{scans.length} scans</span>
        </div>

        <div className="comp-thumb-grid">
          {scans.length === 0 && (
            <div className="sidebar-empty">Capture scans to compare — add 2 or more</div>
          )}
          {scans.map((scan, idx) => (
            <div key={scan.name ?? idx} className="comp-thumb-item" onClick={() => setFullscreenUrl(scan.url)}>
              <img src={scan.url} alt={`Scan ${idx + 1}`} />
              <div className="comp-thumb-overlay">
                <span className="comp-thumb-num">#{idx + 1}</span>
                <ClassificationIcon classification={scan.classification} size={11} />
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-capture comp-actions">
          <button className="analyze-all-btn" onClick={() => setShowAnalysis(true)} disabled={scans.length < 2}>
            <BarChart2 size={18} />
            Analyze All ({scans.length})
          </button>
          <button className="complete-session-btn" onClick={handleMarkComplete} disabled={scans.length < 2}>
            <CheckCircle2 size={18} />
            Mark as Complete
          </button>
        </div>
      </aside>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
      {showAnalysis  && <ComparativeAnalysisModal scans={scans} onClose={() => setShowAnalysis(false)} />}
    </div>
  );
}
