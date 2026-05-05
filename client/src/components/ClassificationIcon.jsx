import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";

export default function ClassificationIcon({ classification, size = 13 }) {
  if (classification === "Critical") return <Zap size={size} className="class-icon critical" />;
  if (classification === "Warning")  return <AlertTriangle size={size} className="class-icon warning" />;
  return <CheckCircle2 size={size} className="class-icon normal" />;
}
