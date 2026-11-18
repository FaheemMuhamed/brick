import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

const ToggleGroup = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <ToggleGroupPrimitive.Root ref={ref} className={cn('flex items-center gap-1 rounded-lg bg-muted p-1', className)} {...props} />
  ),
);
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>>(
  ({ className, ...props }, ref) => (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center rounded-md px-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:font-bold data-[state=on]:shadow-sm',
        className,
      )}
      {...props}
    />
  ),
);
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
