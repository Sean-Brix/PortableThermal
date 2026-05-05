import { useEffect } from "react";
import { Settings } from "lucide-react";

export default function AdminAccessModal({ onConfirm, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="admin-access-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-access-icon"><Settings size={28} /></div>
        <h3>Admin Access</h3>
        <p>Switch to the admin panel?</p>
        <div className="admin-access-actions">
          <button className="admin-access-confirm" onClick={onConfirm}>Enter Admin Panel</button>
          <button className="admin-access-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
