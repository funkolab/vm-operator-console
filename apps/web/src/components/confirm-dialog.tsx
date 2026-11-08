import { type ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "./page";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  typeToConfirm,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  typeToConfirm?: string;
  onConfirm: () => Promise<unknown> | unknown;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = !!typeToConfirm && typed !== typeToConfirm;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          onOpenChange(o);
          if (!o) setTyped("");
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        {typeToConfirm && (
          <div className="grid gap-2">
            <Label htmlFor="confirm-input" className="text-sm font-normal">
              Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
            </Label>
            <Input id="confirm-input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
