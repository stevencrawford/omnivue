import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Toast } from "../components/Toast";

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastKey, setToastKey] = useState(0);

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    setToastVisible(true);
    setToastKey((k) => k + 1);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast key={toastKey} message={toastMsg} visible={toastVisible} onHide={hideToast} />
    </ToastContext.Provider>
  );
}
