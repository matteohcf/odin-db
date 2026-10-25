import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Label } from "@odin-db/ui/components/label";
import { cn } from "@odin-db/ui/lib/utils";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorMessage } from "@/lib/ipc";
import { useConnect, useTrustHostKey } from "../api/mutations";
import { useProfile } from "../api/queries";
import { useExplorer } from "../store/explorer-store";
import { type HostKeyPrompt, useHostKeyPrompt } from "../store/host-key-store";

/** Asks whether to trust an SSH server's host key, then connects (ADR-0036). */
export function HostKeyDialog() {
  const prompt = useHostKeyPrompt((s) => s.prompt);
  const dismiss = useHostKeyPrompt((s) => s.dismiss);
  return (
    <AlertDialog open={prompt !== null} onOpenChange={(open) => !open && dismiss()}>
      {/* Keyed so the confirmation checkbox resets for every prompt. */}
      {prompt && <HostKeyContent key={prompt.fingerprint} prompt={prompt} onDone={dismiss} />}
    </AlertDialog>
  );
}

function HostKeyContent({ prompt, onDone }: { prompt: HostKeyPrompt; onDone: () => void }) {
  const { t } = useTranslation("connections");
  const id = useId();
  const profile = useProfile(prompt.profileId);
  const trust = useTrustHostKey();
  const connect = useConnect();
  const [confirmed, setConfirmed] = useState(false);
  const setExpanded = useExplorer((s) => s.setExpanded);
  const setManagerOpen = useExplorer((s) => s.setManagerOpen);
  const Icon = prompt.changed ? ShieldAlert : ShieldQuestion;

  async function onTrust() {
    try {
      await trust.mutateAsync({ profileId: prompt.profileId, fingerprint: prompt.fingerprint });
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    onDone();
    // The dialog unmounts now, so per-call callbacks would never run: await instead.
    // Like any connect from the connection manager, a success closes it and shows the
    // databases; failures are reported by `useConnect` and the app-wide error toast.
    await connect.mutateAsync(prompt.profileId).then(
      () => {
        setExpanded(prompt.profileId, true);
        setManagerOpen(false);
      },
      () => {},
    );
  }

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <Icon className={cn("size-5", prompt.changed ? "text-destructive" : "text-warning")} />
          {prompt.changed ? t("hostKey.changedTitle") : t("hostKey.unknownTitle")}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {prompt.changed
            ? t("hostKey.changedBody", {
                name: profile?.name ?? "",
                host: profile?.ssh?.host ?? "",
              })
            : t("hostKey.unknownBody", {
                name: profile?.name ?? "",
                host: profile?.ssh?.host ?? "",
              })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">{t("hostKey.fingerprint")}</span>
        <code className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs selectable">
          {prompt.fingerprint}
        </code>
      </div>
      {prompt.changed && (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={`${id}-confirm`}
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            className="mt-0.5"
          />
          <Label htmlFor={`${id}-confirm`} className="font-normal text-sm">
            {t("hostKey.changedConfirm")}
          </Label>
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
        <AlertDialogAction
          disabled={(prompt.changed && !confirmed) || trust.isPending}
          className={cn(prompt.changed && "bg-destructive text-white hover:bg-destructive/90")}
          onClick={(event) => {
            event.preventDefault();
            void onTrust();
          }}
        >
          {prompt.changed ? t("hostKey.trustNew") : t("hostKey.trust")}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
