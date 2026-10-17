import { Toaster } from "@odin-db/ui/components/sonner";
import { ThemeProvider } from "@odin-db/ui/components/theme-provider";
import { TooltipProvider } from "@odin-db/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createQueryClient } from "./query-client";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider storageKey="odin-db.theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
