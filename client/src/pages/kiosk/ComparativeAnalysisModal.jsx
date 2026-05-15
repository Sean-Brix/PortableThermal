import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, X, Zap } from "lucide-react";
import ClassificationIcon from "../../components/ClassificationIcon";
import Checklist from "../../components/Checklist";
import FullscreenModal from "../../components/FullscreenModal";
import { formatTime } from "../../utils/formatUtils";
import { computeReferenceTemperature, getComparativeRecommendation, getWorstComparativeRecommendation } from "../../utils/thermalUtils";
import { EC_TODO } from "./kioskConstants";

export default function ComparativeAnalysisModal({ scans, onClose }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);

  const temps    = scans.map((s) => Number(s.temperature));
  const valid    = temps.filter((v) => Number.isFinite(v));
  const tref     = computeReferenceTemperature(valid);
  const deltas   = scans.map((s) => Number(s.temperature) - tref);
  const avgDelta = deltas.length ? deltas.reduce((a, v) => a + v, 0) / deltas.length : 0;
  const dVar     = deltas.length ? deltas.reduce((a, v) => a + Math.pow(v - avgDelta, 2), 0) / deltas.length : 0;
  const stdDev       = Math.sqrt(dVar).toFixed(1);
  const avgTemp      = valid.length ? (valid.reduce((a, v) => a + v, 0) / valid.length).toFixed(1) : "0.0";
  const maxTemp      = valid.length ? Math.max(...valid) : 0;
  const avgDeltaStr  = avgDelta.toFixed(1);
  const maxDelta     = deltas.length ? Math.max(...deltas) : 0;
  const chartMax     = Math.max(maxTemp, tref, 1) * 1.15;
  const deltaMax     = Math.max(maxDelta, 1) * 1.15;
  const overall      = getWorstComparativeRecommendation(deltas);

  const critical = scans.filter((s) => s.classification === "Critical").length;
  const warning  = scans.filter((s) => s.classification === "Warning").length;
  const normal   = scans.filter((s) => s.classification === "Normal").length;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop modal-backdrop-fullscreen" onClick={onClose}>
      <div className="comp-analysis-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comp-modal-header">
          <h2>Comparative Analysis</h2>
          <button className="analyze-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="comp-modal-body">
          <div className="comp-stats">
            <div className="comp-stat-card">
              <div className="comp-stat-value">{tref.toFixed(1)}°C</div>
              <div className="comp-stat-label">TRef</div>
            </div>
            <div className="comp-stat-card peak">
              <div className="comp-stat-value">{avgDeltaStr}°C</div>
              <div className="comp-stat-label">Avg ΔT</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{maxDelta.toFixed(1)}°C</div>
              <div className="comp-stat-label">Peak ΔT</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{avgTemp}°C</div>
              <div className="comp-stat-label">Avg Temp</div>
            </div>
          </div>

          <div className={`comp-recommendation-callout ${overall.tone}`}>
            <div className="comp-recommendation-title">Recommended action</div>
            <div className="comp-recommendation-text">{overall.action}</div>
            <div className="comp-recommendation-meta">Highest ΔTref in this set: {maxDelta.toFixed(1)}°C</div>
          </div>

          <div className="comp-classification-row">
            <span className="cls-chip critical"><Zap size={12} /> {critical} Critical</span>
            <span className="cls-chip warning"><AlertTriangle size={12} /> {warning} Warning</span>
            <span className="cls-chip normal"><CheckCircle2 size={12} /> {normal} Normal</span>
          </div>

          <div className="comp-chart-section">
            <h3>Reference & Delta Charts</h3>
            <div className="comp-chart-area comp-reference-chart">
              <div className="comp-chart-label-row">
                <span>Temperature vs reference</span>
                <span>TRef = average of collected temperatures after outlier removal</span>
              </div>
              <div className="comp-chart-temp-wrap">
                <div className="comp-reference-line" style={{ bottom: `${(tref / chartMax) * 100}%` }}>
                  <span>TRef {tref.toFixed(1)}°C</span>
                </div>
                <div className="comp-chart">
                  {scans.map((scan, i) => {
                    const temp = Number(scan.temperature);
                    const delta = temp - tref;
                    const rec = getComparativeRecommendation(delta);
                    const h = Number.isFinite(temp) ? Math.max((temp / chartMax) * 140, 4) : 4;
                    return (
                      <div key={scan.name ?? i} className="chart-group comp-chart-group">
                        <div className={`chart-bar high ${rec.tone}`} style={{ height: `${h}px` }} title={`Temp ${temp.toFixed(1)}°C`} />
                        <div className="chart-group-label">#{i + 1}</div>
                        <div className="comp-delta-value">Δ {delta.toFixed(1)}°C</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot high" />Temp</span>
                <span><span className="legend-dot ref" />TRef</span>
              </div>
            </div>

            <div className="comp-chart-area comp-delta-chart">
              <div className="comp-chart-label-row">
                <span>Temperature difference</span>
                <span>ΔT = Temperature - TRef</span>
              </div>
              <div className="comp-delta-grid">
                {scans.map((scan, i) => {
                  const temp  = Number(scan.temperature);
                  const delta = temp - tref;
                  const rec   = getComparativeRecommendation(delta);
                  const h     = Math.max((Math.max(delta, 0) / deltaMax) * 110, 4);
                  return (
                    <div key={scan.name ?? i} className="comp-delta-item">
                      <div className="comp-delta-track">
                        <div className={`comp-delta-bar ${rec.tone}`} style={{ height: `${h}px` }} />
                      </div>
                      <div className="comp-delta-label">#{i + 1}</div>
                      <div className="comp-delta-value">{delta.toFixed(1)}°C</div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot delta" />ΔT per component</span>
              </div>
            </div>
          </div>

          <div className="comp-table-section">
            <h3>Scan Details</h3>
            <table className="comp-details-table">
              <thead>
                <tr><th>#</th><th>Temp (°C)</th><th>TRef (°C)</th><th>ΔT (°C)</th><th>Recommended action</th><th>Captured</th></tr>
              </thead>
              <tbody>
                {scans.map((scan, i) => {
                  const temp  = Number(scan.temperature);
                  const delta = temp - tref;
                  const rec   = getComparativeRecommendation(delta);
                  return (
                    <tr key={scan.name ?? i}>
                      <td>#{i + 1}</td>
                      <td>{Number.isFinite(temp) ? temp.toFixed(1) : "-"}</td>
                      <td>{tref.toFixed(1)}</td>
                      <td>{delta.toFixed(1)}</td>
                      <td><span className={`scan-badge ${rec.tone}`}>{rec.label}</span></td>
                      <td>{scan.displayTime || formatTime(scan.loggedAt || scan.createdAt || scan.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="comp-images-section">
            <h3>Captured Images ({scans.length})</h3>
            <div className="comp-image-grid">
              {scans.map((scan, i) => (
                <div key={i} className="comp-image-item" onClick={() => setFullscreenUrl(scan.url)}>
                  <img src={scan.url} alt={`Scan ${i + 1}`} />
                  <span className="comp-image-num">#{i + 1}</span>
                  <div className="comp-image-footer">
                    <span className={`scan-badge ${scan.classification?.toLowerCase()}`}>{scan.classification}</span>
                    <span className="comp-image-temp">{scan.temperature}°C</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="comp-recs-section">
            <h3>Recommendations</h3>
            <p>Actions are selected from the comparative temperature-difference table: 1°C-3°C possible deficiency, 4°C-15°C probable deficiency, and above 15°C major discrepancy.</p>
            <Checklist items={EC_TODO.slice(1)} storageKeyPrefix="comparative" idKey="comparative-overview" />
            <p className="analysis-summary">
              TRef: {tref.toFixed(1)}°C. Average ΔT: {avgDeltaStr}°C. Standard deviation: {stdDev}°C.
            </p>
          </div>
        </div>
      </div>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}
