import * as React from "react";

import { cn } from "../../lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const isControlled = value !== undefined;
  const selected = isControlled ? value! : internalValue;

  const setValue = React.useCallback(
    (next: string) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  React.useEffect(() => {
    if (!isControlled && !internalValue && defaultValue) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, internalValue, isControlled]);

  return (
    <TabsContext.Provider value={{ value: selected, setValue }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-12 items-center justify-start gap-2 rounded-xl bg-slate-100 p-1 text-sm font-medium text-slate-600",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) {
      throw new Error("TabsTrigger must be used within Tabs");
    }
    const active = context.value === value;
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => context.setValue(value)}
        className={cn(
          "flex-1 rounded-lg px-3 py-2 transition-colors",
          active ? "bg-white shadow text-slate-900" : "hover:bg-white/70",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) {
      throw new Error("TabsContent must be used within Tabs");
    }
    const isActive = context.value === value;
    if (!isActive) {
      return null;
    }
    return (
      <div ref={ref} className={cn("mt-6", className)} {...props}>
        {children}
      </div>
    );
  },
);
TabsContent.displayName = "TabsContent";
