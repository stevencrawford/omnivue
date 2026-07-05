import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Toast, type ToastAction } from "../components/Toast";

interface ToastContextValue {
  showToast: (message: string, action?: ToastAction, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState("");
  const [toastAction, setToastAction] = useState<ToastAction | undefined>(undefined);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastDuration, setToastDuration] = useState<number | undefined>(undefined);
  const [toastKey, setToastKey] = useState(0);

  const showToast = useCallback((message: string, action?: ToastAction, durationMs?: number) => {
    setToastMsg(message);
    setToastAction(action);
    setToastDuration(durationMs);
    setToastVisible(true);
    setToastKey((k) => k + 1);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        key={toastKey}
        message={toastMsg}
        action={toastAction}
        visible={toastVisible}
        onHide={hideToast}
        durationMs={toastDuration}
      />
    </ToastContext.Provider>
  );
}
