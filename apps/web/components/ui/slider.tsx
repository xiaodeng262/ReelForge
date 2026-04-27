"use client";
import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex items-center select-none touch-none w-full h-6", className)}
    {...props}
  >
    <SliderPrimitive.Track className="bg-paper/10 relative grow h-[2px] overflow-hidden">
      <SliderPrimitive.Range className="absolute h-full bg-ember" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3 w-3 bg-ember border border-ink focus:outline-none focus:ring-2 focus:ring-ember/40 focus:ring-offset-2 focus:ring-offset-ink transition" />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";

export { Slider };
