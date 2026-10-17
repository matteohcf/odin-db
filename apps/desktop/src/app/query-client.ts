import { MutationCache, QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { toast } from "sonner";
import { errorMessage } from "@/lib/ipc";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** The mutation shows its own error (e.g. inline in a form): skip the global toast. */
      handlesErrors?: boolean;
    };
  }
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Backend data only changes through our own commands, so focus refetching is noise.
      queries: { refetchOnWindowFocus: false, retry: false },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.handlesErrors) return;
        toast.error(i18n.t("common:errors.unexpected", { message: errorMessage(error) }));
      },
    }),
  });
}
