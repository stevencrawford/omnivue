import { useCallback, useEffect, useState } from "react";

export type BrowserPermission = "default" | "granted" | "denied" | "unsupported";

/**
 * Wraps the Web Notifications API permission state. Returns the current
 * permission plus a `request` function that triggers the browser prompt.
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<BrowserPermission>(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission as BrowserPermission;
  });

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    // Poll for permission changes (browsers don't fire events for this).
    const id = setInterval(() => {
      setPermission(Notification.permission as BrowserPermission);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as BrowserPermission);
    } catch {
      // ignore
    }
  }, []);

  return { permission, request };
}
