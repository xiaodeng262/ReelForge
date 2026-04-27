"use client";
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

/**
 * "墨迹填充"风格进度条：细线 + 琥珀填充 + 顶端小圆点
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { tone?: "ember" | "moss" | "rust" }
>(({ className, value, tone = "ember", ...props }, ref) => {
  const fill = tone === "ember" ? "bg-ember" : tone === "moss" ? "bg-moss" : "bg-rust";
  const progressValue = value ?? 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-[2px] w-full overflow-hidden bg-paper/10",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full transition-transform duration-700 ease-[cubic-bezier(0.7,0,0.2,1)]", fill)}
        style={{ transform: `translateX(-${100 - progressValue}%)` }}
      />
      {value != null && value > 0 && value < 100 ? (
        <span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-[left] duration-700",
            fill,
          )}
          style={{ left: `calc(${value}% - 4px)` }}
        />
      ) : null}
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";

export { Progress };
