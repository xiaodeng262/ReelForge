import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 徽章：报纸分类标签风格
 * - mono 字体，字母间距大，纸白底配深墨字
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-mega-wide font-medium border",
  {
    variants: {
      variant: {
        outline: "border-paper/30 text-paper bg-transparent",
        paper: "bg-paper text-ink border-paper",
        ember: "bg-ember text-ink border-ember-deep",
        moss: "bg-moss/15 text-moss border-moss/50",
        rust: "bg-rust/15 text-[#E68770] border-rust/50",
        ash: "text-ash border-ash/30 bg-ash/5",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
