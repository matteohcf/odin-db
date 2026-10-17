import { Button } from "@odin-db/ui/components/button";
import { Loader2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConnect, useSaveProfile, useTestConnection } from "../api/mutations";
import { useExplorer } from "../store/explorer-store";

const LOCALHOST = {
  name: "Local",
  connectionString: "mongodb://localhost:27017",
  password: null,
  readOnly: false,
};

/** First-run shortcut: saves and opens a local server, but only if one answers. */
export function TryLocalhostButton() {
  const { t } = useTranslation("connections");
  const test = useTestConnection();
  const save = useSaveProfile();
  const connect = useConnect();
  const setExpanded = useExplorer((s) => s.setExpanded);
  const busy = test.isPending || save.isPending || connect.isPending;

  async function tryLocalhost() {
    try {
      await test.mutateAsync({ input: LOCALHOST });
    } catch {
      toast.error(t("explorer.localhostMissing"));
      return;
    }
    const saved = await save.mutateAsync({ input: LOCALHOST });
    // This button unmounts once the profile exists, so wait on the promise: per-call
    // callbacks of an unmounted component never run.
    // A failure is already reported by the app-wide mutation error toast.
    const connected = await connect.mutateAsync(saved.id).then(
      () => true,
      () => false,
    );
    if (connected) setExpanded(saved.id, true);
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void tryLocalhost()}>
      {busy ? <Loader2 className="animate-spin" /> : <Zap />}
      {t("explorer.localhost")}
    </Button>
  );
}
