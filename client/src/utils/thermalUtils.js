export const COMPARATIVE_RECOMMENDATIONS = [
  { key: "normal",   label: "No significant difference", action: "Continue routine monitoring.",                             tone: "normal"   },
  { key: "possible", label: "Possible deficiency",        action: "Possible deficiency; warrants investigation.",            tone: "warning"  },
  { key: "probable", label: "Probable deficiency",        action: "Indicates probable deficiency; repair as time permits.",  tone: "warning"  },
  { key: "major",    label: "Major discrepancy",          action: "Major discrepancy; repair immediately.",                  tone: "critical" }
];

export function computeReferenceTemperature(values) {
  const finiteValues = values.filter((v) => Number.isFinite(v));
  if (finiteValues.length === 0) return 0;
  if (finiteValues.length === 1) return finiteValues[0];

  const mean = finiteValues.reduce((s, v) => s + v, 0) / finiteValues.length;
  const variance = finiteValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / finiteValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return mean;
  const filtered = finiteValues.filter((v) => Math.abs((v - mean) / stdDev) <= 2.0);
  const safe = filtered.length > 0 ? filtered : finiteValues;
  return safe.reduce((s, v) => s + v, 0) / safe.length;
}

export function getComparativeRecommendation(delta) {
  if (!Number.isFinite(delta) || delta < 1) return COMPARATIVE_RECOMMENDATIONS[0];
  const r = Math.round(delta);
  if (r <= 3)  return COMPARATIVE_RECOMMENDATIONS[1];
  if (r <= 15) return COMPARATIVE_RECOMMENDATIONS[2];
  return COMPARATIVE_RECOMMENDATIONS[3];
}

export function getWorstComparativeRecommendation(deltas) {
  return deltas.reduce((worst, delta) => {
    const cur  = getComparativeRecommendation(delta);
    const curR = COMPARATIVE_RECOMMENDATIONS.findIndex((x) => x.key === cur.key);
    const wR   = COMPARATIVE_RECOMMENDATIONS.findIndex((x) => x.key === worst.key);
    return curR > wR ? cur : worst;
  }, COMPARATIVE_RECOMMENDATIONS[0]);
}

export function buildComparativeAnalysisSummary(scans) {
  const temps = scans.map((s) => Number(s.temperature)).filter((v) => Number.isFinite(v));
  const tref  = computeReferenceTemperature(temps);
  const deltas = scans.map((s) => Number(s.temperature) - tref);
  const finite = deltas.filter((v) => Number.isFinite(v));
  const avgDelta = finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : 0;
  const variance = finite.length
    ? finite.reduce((s, v) => s + Math.pow(v - avgDelta, 2), 0) / finite.length
    : 0;

  return {
    scanCount: scans.length,
    tref,
    avgDelta,
    peakDelta: finite.length ? Math.max(...finite) : 0,
    avgTemperature: temps.length ? temps.reduce((s, v) => s + v, 0) / temps.length : 0,
    minTemperature: temps.length ? Math.min(...temps) : 0,
    maxTemperature: temps.length ? Math.max(...temps) : 0,
    standardDeviation: Math.sqrt(variance),
    classificationCounts: {
      Critical: scans.filter((s) => s.classification === "Critical").length,
      Warning:  scans.filter((s) => s.classification === "Warning").length,
      Normal:   scans.filter((s) => s.classification === "Normal").length
    },
    overallRecommendation: getWorstComparativeRecommendation(finite),
    scanAnalyses: scans.map((s, i) => {
      const delta = Number(s.temperature) - tref;
      return {
        id: s.scanLogId || s.id || s.name,
        index: i + 1,
        temperature: Number(s.temperature),
        delta,
        recommendation: getComparativeRecommendation(delta)
      };
    })
  };
}

export function classifyReading(temp, ambient) {
  const temperature = Number(temp);
  const ambiance    = Number(ambient);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) return "Unknown";
  const diff  = temperature - ambiance;
  const ratio = diff / ambiance;
  if (ratio > 0.5 || diff > 50) return "Critical";
  if (ratio > 0.25 || diff > 25) return "Warning";
  return "Normal";
}
