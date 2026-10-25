import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { toast } from "sonner";
import { connectionsKey } from "@/features/connections";
import { errorMessage, hostKeyError, isNotConnectedError } from "@/lib/ipc";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** The mutation shows its own error (e.g. inline in a form): skip the global toast. */
      handlesErrors?: boolean;
    };
  }
}

export function createQueryClient() {
  // A connection the backend no longer has (closed elsewhere, dropped by the server) is
  // refreshed out of the open ones, so the sidebar stops showing it as connected.
  const forgetLost = (error: unknown) => {
    if (isNotConnectedError(error)) {
      void client.invalidateQueries({ queryKey: connectionsKey, exact: true });
    }
  };
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      // Backend data only changes through our own commands, so focus refetching is noise.
      queries: { refetchOnWindowFocus: false, retry: false },
    },
    queryCache: new QueryCache({ onError: forgetLost }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        forgetLost(error);
        // Host keys are confirmed in their own dialog, not reported as failures.
        if (mutation.meta?.handlesErrors || hostKeyError(error)) return;
        toast.error(i18n.t("common:errors.unexpected", { message: errorMessage(error) }));
      },
    }),
  });
  return client;
}
