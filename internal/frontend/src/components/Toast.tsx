import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  visible: boolean;
  onHide: () => void;
}

export function Toast({ message, visible, onHide }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onHide();
      }, 2000);
      return () => clearTimeout(timer);
    }
    setShow(false);
  }, [visible, onHide]);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
      <div className="bg-surface-elevated text-gh-text text-xs px-4 py-2 rounded-lg shadow-xl border border-accent-border whitespace-nowrap">
        {message}
      </div>
    </div>
  );
}
