import { Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUTS } from "./command-palette";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Press G then a letter to jump between sections.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between py-2 text-sm">
              <span>{s.label}</span>
              <span className="flex gap-1">
                {s.keys.split(" ").map((k) => (
                  <kbd key={k} className="bg-muted text-muted-foreground min-w-6 rounded border px-1.5 py-0.5 text-center font-mono text-[11px] shadow-xs">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
