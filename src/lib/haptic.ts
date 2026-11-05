/**
 * Trigger subtle haptic vibration on supported mobile devices (PWA / Android / Chrome).
 */
export function triggerHaptic(duration = 10): void {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(duration);
    } catch {
      /* Ignore if blocked or unsupported by browser */
    }
  }
}
