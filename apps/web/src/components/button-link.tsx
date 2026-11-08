import { createLink, type LinkComponent } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import { type AnchorHTMLAttributes, forwardRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants> & { disabled?: boolean };

const Anchor = forwardRef<HTMLAnchorElement, AnchorProps>(({ className, variant, size, disabled, children, ...props }, ref) => {
  // A disabled link renders as a real disabled button: not focusable, not navigable.
  if (disabled)
    return (
      <Button type="button" variant={variant} size={size} className={className} disabled>
        {children}
      </Button>
    );
  return (
    <a ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </a>
  );
});
Anchor.displayName = "Anchor";

const CreatedLink = createLink(Anchor);

/** Router link styled as a button, with proper disabled semantics. */
export const ButtonLink: LinkComponent<typeof Anchor> = (props) => <CreatedLink preload="intent" {...props} />;
