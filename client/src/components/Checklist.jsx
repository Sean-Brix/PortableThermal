import { useEffect, useState } from "react";

export default function Checklist({ items = [], storageKeyPrefix = "checklist", idKey = "default" }) {
  const key = `${storageKeyPrefix}:${idKey}`;
  const [checked, setChecked] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(checked)); } catch {}
  }, [key, checked]);

  const toggle = (i) => setChecked((prev) => ({ ...prev, [i]: !prev[i] }));

  return (
    <div className="todo-checklist">
      <ul>
        {items.map((item, i) => (
          <li key={i} className={`todo-item ${checked[i] ? "done" : ""}`}>
            <label>
              <input type="checkbox" checked={!!checked[i]} onChange={() => toggle(i)} />
              <span className="todo-label">{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
