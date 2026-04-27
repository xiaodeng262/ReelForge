import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 按钮变体：editorial 调性
 * - forge: 琥珀主 CTA，带"铸印"感的 ember glow
 * - ghost: 透明，hover 时 underline（像文字链接）
 * - outline: 纸色细边，hover 填充墨色
 * - press: 纸面凸版风格，按下去像铅字
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        forge:
          "bg-ember text-ink border border-ember-deep/60 hover:bg-ember-deep hover:text-paper shadow-[inset_0_-2px_0_rgba(11,13,10,0.25),0_0_0_1px_rgba(11,13,10,0.4)] hover:shadow-ember-glow",
        outline:
          "border border-paper/25 text-paper bg-transparent hover:bg-paper hover:text-ink hover:border-paper",
        ghost:
          "text-paper hover:text-ember underline-offset-[6px] hover:underline decoration-ember/60 decoration-1",
        press:
          "bg-paper text-ink border border-ink shadow-press hover:translate-y-[1px] hover:shadow-[0_0_0_0_rgba(11,13,10,0.8)]",
        quiet:
          "text-ash hover:text-paper",
        destructive:
          "bg-rust/90 text-paper hover:bg-rust",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
