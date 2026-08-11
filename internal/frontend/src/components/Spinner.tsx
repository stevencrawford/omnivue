export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      className={`${className} rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0`}
    />
  );
}
