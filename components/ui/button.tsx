import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// DESIGN.md buttons: 40px tall, 16px radius, 14px/700 labels. Red (default) is the only primary CTA.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm leading-none font-bold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-focus-outer focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:bg-surface-card disabled:text-ash aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // button-primary
        default: "bg-primary text-primary-foreground hover:bg-primary-pressed active:bg-primary-pressed",
        // button-secondary
        secondary: "bg-secondary-bg text-ink hover:bg-secondary-pressed active:bg-secondary-pressed aria-expanded:bg-secondary-pressed",
        // filter-chip style: cream fill, no border
        outline: "bg-surface-card text-ink hover:bg-secondary-bg active:bg-secondary-pressed aria-expanded:bg-secondary-bg",
        // button-tertiary
        ghost: "bg-transparent text-ink hover:bg-surface-card active:bg-secondary-bg aria-expanded:bg-surface-card",
        destructive: "bg-error/10 text-error hover:bg-error/15 active:bg-error/20",
        link: "text-ink-soft font-semibold underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-1.5 px-3.5 py-1.5",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base",
        // button-icon-circular
        icon: "size-10 rounded-full",
        "icon-xs": "size-7 rounded-full [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9 rounded-full",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
