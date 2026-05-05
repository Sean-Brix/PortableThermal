import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import FullscreenModal from "../../components/FullscreenModal";
import SingleScanResultModal from "./SingleScanResultModal";

export default function SingleScanPage({ videoCallbackRef, isCameraReady, isSaving, status, error, scan, onCapture, onBack }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [isScanVisible, setIsScanVisible] = useState(Boolean(scan));

  useEffect(() => {
    setIsScanVisible(Boolean(scan));
  }, [scan?.id, scan?.timestamp, scan?.url]);

  return (
    <div className="scan-layout single-layout">
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

      {scan && isScanVisible && (
        <SingleScanResultModal
          scan={scan}
          onClose={() => setIsScanVisible(false)}
          onFullscreen={() => setFullscreenUrl(scan.url)}
        />
      )}
      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}
