import type RFB from "@novnc/novnc";
import { ClipboardPaste, Expand, Keyboard, Loader2, Maximize2, MonitorPlay, MonitorX, Power, RefreshCw, Shrink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basePath } from "@/lib/api";
import { cn } from "@/lib/utils";

type State = "idle" | "connecting" | "connected" | "disconnected" | "error";

const KEYS: { label: string; keys: [number, string][] }[] = [
  { label: "Ctrl + Alt + Delete", keys: [] },
  {
    label: "Ctrl + Alt + F1",
    keys: [
      [0xffe3, "ControlLeft"],
      [0xffe9, "AltLeft"],
      [0xffbe, "F1"],
    ],
  },
  {
    label: "Ctrl + Alt + F2",
    keys: [
      [0xffe3, "ControlLeft"],
      [0xffe9, "AltLeft"],
      [0xffbf, "F2"],
    ],
  },
  {
    label: "Ctrl + C",
    keys: [
      [0xffe3, "ControlLeft"],
      [0x0063, "KeyC"],
    ],
  },
  { label: "Escape", keys: [[0xff1b, "Escape"]] },
  { label: "Tab", keys: [[0xff09, "Tab"]] },
];

/**
 * In-browser VNC console. The websocket goes to the console server, which
 * authorizes the user (impersonated `update` on the VM) and bridges to the
 * Prism Central VNC proxy; Prism credentials never reach the browser.
 */
export function VMConsole({ ns, name, poweredOn, canOpen }: { ns: string; name: string; poweredOn: boolean; canOpen: boolean }) {
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [state, setState] = useState<State>("idle");
  const [reason, setReason] = useState<string>();
  const [scaled, setScaled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const disconnect = useCallback(() => {
    rfb.current?.disconnect();
    rfb.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!screen.current) return;
    disconnect();
    setState("connecting");
    setReason(undefined);
    const { default: RFBClass } = await import("@novnc/novnc");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}${basePath}/api/namespaces/${encodeURIComponent(ns)}/vms/${encodeURIComponent(name)}/console`;
    try {
      const r = new RFBClass(screen.current, url, { shared: true, wsProtocols: ["binary"] });
      r.scaleViewport = scaled;
      r.resizeSession = false;
      r.focusOnClick = true;
      r.background = "#0b0d12";
      r.qualityLevel = 6;
      r.addEventListener("connect", () => {
        setState("connected");
        r.focus();
      });
      r.addEventListener("disconnect", (e) => {
        const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
        setState(clean ? "disconnected" : "error");
        if (!clean) setReason("The connection was closed. Check that the VM is powered on and that you can update it.");
        rfb.current = null;
      });
      r.addEventListener("securityfailure", (e) => {
        setState("error");
        setReason((e as CustomEvent<{ reason?: string }>).detail?.reason ?? "Security negotiation failed");
      });
      rfb.current = r;
    } catch (e) {
      setState("error");
      setReason((e as Error).message);
    }
  }, [ns, name, scaled, disconnect]);

  useEffect(() => () => disconnect(), [disconnect]);

  useEffect(() => {
    if (rfb.current) rfb.current.scaleViewport = scaled;
  }, [scaled]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const sendCombo = (keys: [number, string][]) => {
    const r = rfb.current;
    if (!r) return;
    if (!keys.length) return r.sendCtrlAltDel();
    for (const [sym, code] of keys) r.sendKey(sym, code, true);
    for (const [sym, code] of [...keys].reverse()) r.sendKey(sym, code, false);
    r.focus();
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      // Type the text: most guests ignore the VNC clipboard without an agent.
      for (const ch of text.slice(0, 2000)) {
        const code = ch.codePointAt(0) ?? 0;
        const sym = ch === "\n" ? 0xff0d : code < 0x100 ? code : 0x01000000 | code;
        rfb.current?.sendKey(sym, null);
      }
      toast.success(`Typed ${Math.min(text.length, 2000)} characters into the console`);
    } catch {
      toast.error("Clipboard access was denied by the browser");
    }
  };

  const overlay = state !== "connected";

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MonitorPlay className="text-muted-foreground size-4" /> Console
          <span
            className={cn(
              "ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
              state === "connected"
                ? "bg-success/10 text-success ring-success/25"
                : state === "connecting"
                  ? "bg-info/10 text-info ring-info/25"
                  : "bg-muted text-muted-foreground ring-border",
            )}
          >
            {state === "connecting" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span className={cn("size-1.5 rounded-full", state === "connected" ? "bg-success" : "bg-muted-foreground/60")} />
            )}
            {state === "connected" ? "Connected" : state === "connecting" ? "Connecting" : "Not connected"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={state !== "connected"}>
                <Keyboard /> Send keys
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-muted-foreground text-xs">Key combinations</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {KEYS.map((k) => (
                <DropdownMenuItem key={k.label} onSelect={() => sendCombo(k.keys)}>
                  {k.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" disabled={state !== "connected"} onClick={paste} aria-label="Type clipboard">
                <ClipboardPaste />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Type clipboard contents</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setScaled((s) => !s)} aria-label="Toggle scaling">
                {scaled ? <Expand /> : <Shrink />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{scaled ? "Native resolution" : "Fit to window"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => (fullscreen ? document.exitFullscreen() : frame.current?.requestFullscreen())}
                aria-label="Fullscreen"
              >
                <Maximize2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fullscreen</TooltipContent>
          </Tooltip>
          {state === "connected" ? (
            <Button variant="outline" size="sm" className="ml-1" onClick={() => disconnect()}>
              <MonitorX /> Disconnect
            </Button>
          ) : (
            <Button size="sm" className="ml-1" disabled={!poweredOn || !canOpen || state === "connecting"} onClick={connect}>
              {state === "connecting" ? <Loader2 className="animate-spin" /> : <RefreshCw />} {state === "idle" ? "Connect" : "Reconnect"}
            </Button>
          )}
        </div>
      </div>
      <div ref={frame} className="relative bg-[#0b0d12]">
        <div ref={screen} className={cn("h-[min(70vh,720px)] w-full", fullscreen && "h-screen")} />
        {overlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,#1a1f2e,#0b0d12)] p-6 text-center text-white">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/8 ring-1 ring-white/10">
              {state === "connecting" ? (
                <Loader2 className="size-6 animate-spin" />
              ) : !poweredOn ? (
                <Power className="size-6 opacity-70" />
              ) : (
                <MonitorPlay className="size-6 opacity-80" />
              )}
            </div>
            <div className="text-[15px] font-semibold">
              {state === "connecting"
                ? "Opening console…"
                : !poweredOn
                  ? "The VM is powered off"
                  : !canOpen
                    ? "Console not available"
                    : state === "error"
                      ? "Console disconnected"
                      : "Remote console"}
            </div>
            <div className="max-w-md text-sm text-white/60">
              {!poweredOn
                ? "Power the VM on to open its console."
                : !canOpen
                  ? "Opening the console requires permission to update this VM."
                  : (reason ?? "Connect to the VM screen through Prism Central. Keyboard and mouse are forwarded; clipboard text can be typed in.")}
            </div>
            {poweredOn && canOpen && state !== "connecting" && (
              <Button size="sm" className="mt-1" onClick={connect}>
                <MonitorPlay /> {state === "idle" ? "Connect" : "Reconnect"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
