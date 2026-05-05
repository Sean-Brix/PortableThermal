import { Camera } from "lucide-react";

const BRAND_LOGO = "/assets/logo.png";

export default function CameraNav({ onNavigate }) {
  return (
    <nav className="app-nav">
      <div className="nav-brand">
        <img className="brand-logo" src={BRAND_LOGO} alt="PortableThermal" />
        <span>PortableThermal</span>
      </div>
      <div className="nav-links">
        <button className="nav-link active"><Camera size={15} /> Test</button>
        <button className="nav-link" onClick={() => onNavigate("kiosk")}>Kiosk</button>
        <button className="nav-link" onClick={() => onNavigate("admin")}>Admin</button>
      </div>
    </nav>
  );
}
