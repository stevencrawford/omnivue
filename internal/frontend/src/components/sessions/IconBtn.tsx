import type { ReactNode } from "react";

interface IconBtnProps {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}

export function IconBtn({ children, onClick, title, active = false }: IconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`cursor-pointer p-0.5 rounded ${
        active ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"
      }`}
    >
      {children}
    </button>
  );
}
