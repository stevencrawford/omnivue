import { Spinner } from "./Spinner";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({
  label = "Loading...",
  className = "flex-1 h-full",
}: LoadingStateProps) {
  return (
    <div
      className={`${className} flex items-center justify-center gap-2 text-sm text-ov-text-secondary`}
    >
      <Spinner />
      {label}
    </div>
  );
}
