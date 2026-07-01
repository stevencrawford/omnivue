import { Bookmark } from "lucide-react";
import { Button } from "../ui/button";

interface BookmarkButtonProps {
  isBookmarked?: boolean;
  onClick: () => void;
  className?: string;
}

export function BookmarkButton({
  isBookmarked = false,
  onClick,
  className = "",
}: BookmarkButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`text-ov-text-secondary hover:text-ov-text ${isBookmarked ? "text-accent" : ""} ${className}`}
      title={isBookmarked ? "Remove bookmark" : "Bookmark"}
    >
      <Bookmark fill={isBookmarked ? "currentColor" : "none"} />
    </Button>
  );
}
