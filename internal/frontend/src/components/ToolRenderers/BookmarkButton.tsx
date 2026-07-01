import { Bookmark } from "lucide-react";

interface BookmarkButtonProps {
  isBookmarked?: boolean;
  onClick: () => void;
  className?: string;
  size?: "sm" | "md";
}

const sizeClasses = {
  sm: "size-5",
  md: "size-6",
};

export function BookmarkButton({
  isBookmarked = false,
  onClick,
  className = "",
  size = "md",
}: BookmarkButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${sizeClasses[size]} flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors ${isBookmarked ? "text-accent" : ""} ${className}`}
      title={isBookmarked ? "Remove bookmark" : "Bookmark"}
    >
      <Bookmark size={size === "sm" ? 12 : 12} fill={isBookmarked ? "currentColor" : "none"} />
    </button>
  );
}
