export const SHOOT_POLL_MS   = 2500;
export const HOLD_DURATION_MS = 1500;

export const RECOMMENDATIONS = {
  Critical: [
    "Immediate shutdown recommended — imminent failure risk",
    "Inspect for overloading or short-circuit conditions",
    "Check for loose or corroded connections",
    "Verify overcurrent protection devices",
    "Review IEC 60364-6:2016 compliance"
  ],
  Warning: [
    "Schedule maintenance within 24-48 hours",
    "Tighten and secure connections",
    "Inspect for corrosion or oxidation",
    "Verify load and current balance",
    "Ensure ventilation and remove debris"
  ],
  Normal: [
    "System operating within normal parameters",
    "Continue routine inspection schedule",
    "Document reading for trend analysis",
    "Ensure ventilation is unobstructed"
  ]
};

export const EC_TODO = [
  "EC 60364-6:2016",
  "Tighten / Secure Connections",
  "Inspect / Clean for Corrosion or Oxidation",
  "Check for Signs of Arcing or Tracking",
  "Verify Load / Current Balance",
  "Ensure Proper Ventilation / Clean Dust or Debris"
];
