import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Snowflake, Sun, Eye, EyeOff, Loader2, Lock, RefreshCw, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { withStepUp } from "@/components/auth/StepUpDialog";
import { blockMyCard, createVaultPass, getMyCardSecurity, lockMyCard, replaceMyCard, setMyCardFrozen, unlockMyCard } from "@/lib/wallet/wallet.functions";

type Sec = Awaited<ReturnType<typeof getMyCardSecurity>>;

const CONFIRM = {
  freeze: { title: "Kaart tijdelijk bevriezen?", body: "Alle QR-codes, live-codes, de wallet-sleutel en NFC werken meteen niet meer, tot je zelf ontdooit. Handig als je je kaart even kwijt bent.", action: "Bevriezen" },
  thaw: { title: "Kaart weer activeren?", body: "Doe dit alleen als je je kaart terug hebt. Daarna werken je codes en wallet-sleutel weer.", action: "Ontdooien" },
  block: { title: "Kaart definitief blokkeren?", body: "Gebruik dit als je kaart gestolen is. Het nummer, alle codes, de wallet-sleutel en gekoppelde fysieke kaarten werken meteen nergens meer. Dit kan niet ongedaan.", action: "Blokkeren" },
  replace: { title: "Kaart vervangen?", body: "Je krijgt een nieuw kaartnummer en een nieuwe sleutel. De oude kaart, oude QR-codes en NFC werken nergens meer.", action: "Vervangen" },
} as const;

/**
 * Owner controls for the private ROUT card: 2FA gate, fresh verification before
 * any private detail is shown, Google Wallet key pass with rotating QR, block and replace.
 * Every decision is enforced server-side; this panel only asks.
 */
export function CardSecurityPanel({ onChange }: { onChange?: () => void }) {
  const load = useServerFn(getMyCardSecurity);
  const unlock = useServerFn(unlockMyCard);
  const lock = useServerFn(lockMyCard);
  const block = useServerFn(blockMyCard);
  const replace = useServerFn(replaceMyCard);
  const issue = useServerFn(createVaultPass);
  const freeze = useServerFn(setMyCardFrozen);
  const [sec, setSec] = useState<Sec | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"block" | "replace" | "freeze" | "thaw" | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try { setSec(await load()); } catch { setSec(null); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const skew = sec ? Date.now() - sec.serverNow : 0;
  const until = sec?.unlockedUntil ? sec.unlockedUntil + skew : 0;
  const unlocked = until > now;
  useEffect(() => { if (sec?.unlockedUntil && !unlocked) onChange?.(); }, [unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide the private side again when the tab is left.
  useEffect(() => {
    if (!unlocked) return;
    const hide = () => { if (document.visibilityState === "hidden") void doLock(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Dat lukte niet. Probeer opnieuw."); } finally { setBusy(null); }
  };
  const doUnlock = () => run("unlock", async () => {
    const r = await withStepUp(() => unlock(), "card_reveal");
    if (!r.ok) throw new Error(r.error === "two_factor_required" ? "Zet eerst tweestapsverificatie aan." : "Je kaart is niet actief.");
    await refresh(); onChange?.();
  });
  const doLock = () => run("lock", async () => { await lock(); await refresh(); onChange?.(); });
  const doBlock = () => run("block", async () => {
    const r = await withStepUp(() => block({ data: { reason: "lost" } }), "card_lifecycle");
    if (!r.ok) throw new Error("Blokkeren lukte niet.");
    toast.success("Je kaart is geblokkeerd. Alle codes en de wallet-sleutel werken niet meer.");
    await refresh(); onChange?.();
  });
  const doFreeze = (frozen: boolean) => run("freeze", async () => {
    await withStepUp(() => freeze({ data: { frozen, space: "root" } }), "card_lifecycle");
    toast.success(frozen ? "Je kaart is bevroren. Codes, QR en wallet-sleutel werken tijdelijk niet." : "Je kaart is weer actief.");
    await refresh(); onChange?.();
  });
  const doReplace = () => run("replace", async () => {
    const r = await withStepUp(() => replace(), "card_lifecycle");
    if (!r.ok) throw new Error(r.error === "rate_limited" ? "Je kunt maximaal 3 keer per dag vervangen." : r.error === "busy" ? "Je kaart werd net al vervangen. Vernieuw de pagina en kijk je nieuwe kaart na." : "Vervangen lukte niet.");
    toast.success("Nieuwe kaart uitgegeven. De oude kaart werkt nergens meer.");
    await refresh(); onChange?.();
  });
  const addGoogle = () => run("google", async () => {
    const tab = window.open("", "_blank");
    try {
      let r = await issue({ data: { passType: "SMART_TAP_KEY" } });
      if (!r.ok && r.error === "locked") {
        const u = await withStepUp(() => unlock(), "card_reveal");
        if (!u.ok) throw new Error("Verificatie nodig.");
        await refresh(); onChange?.();
        r = await issue({ data: { passType: "SMART_TAP_KEY" } });
      }
      if (!r.ok) throw new Error(r.error === "wallet_not_configured" || r.error === "key_not_configured" ? "Google Wallet is nog niet ingesteld door de beheerder." : "Toevoegen aan Google Wallet lukte niet.");
      if (tab) tab.location.href = r.saveUrl; else window.location.href = r.saveUrl;
    } catch (e) { tab?.close(); throw e; }
  });

  if (!sec) return null;
  if (!sec.twoFactor) {
    return (
      <section className="grid gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="flex items-start gap-2 font-medium"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /> Tweestapsverificatie is verplicht voor je ROUT-kaart</p>
        <p className="text-xs text-muted-foreground">Zonder tweede stap kun je je kaart niet claimen, niet bekijken en niet aan je wallet toevoegen.</p>
        <Button asChild size="sm" className="justify-self-start"><Link to="/studio/account">Tweestapsverificatie instellen</Link></Button>
      </section>
    );
  }
  if (!sec.hasCard) return null;
  const state = sec.state;
  const mins = Math.max(0, Math.ceil((until - now) / 1000));

  return (
    <section className="grid gap-3 rounded-2xl border border-border p-3" aria-labelledby="card-sec-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="card-sec-title" className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Beveiliging van je kaart</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{state === "active" ? "Actief" : state === "frozen" ? "Bevroren" : state === "blocked" ? "Geblokkeerd" : "Onbekend"}</span>
      </div>
      <p className="font-mono text-xs tracking-widest">{unlocked ? sec.cardNumber : sec.cardNumber ? `•••• •••• ${sec.cardNumber.slice(-4)}` : "—"}</p>
      {state === "active" && (unlocked ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" aria-hidden /> Privégegevens zichtbaar nog {Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}</span>
          <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy !== null} onClick={() => void doLock()}><EyeOff className="h-3.5 w-3.5" aria-hidden /> Verbergen</Button>
        </div>
      ) : (
        <Button variant="outline" className="h-11 gap-2 rounded-full" disabled={busy !== null} onClick={() => void doUnlock()}>
          {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />} Bevestig wie je bent om je kaart te tonen
        </Button>
      ))}
      {state === "active" && (
        <Button className="h-11 gap-2 rounded-full" disabled={busy !== null || !sec.wallet.google} onClick={() => void addGoogle()}>
          {busy === "google" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4" aria-hidden />} ROUT-kaart toevoegen aan Google Wallet
        </Button>
      )}
      {state === "active" && !sec.wallet.google && <p className="text-[11px] text-muted-foreground">Google Wallet is nog niet ingesteld door de beheerder.</p>}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null || state === "blocked" || state === "unavailable"} onClick={() => setConfirm(state === "frozen" ? "thaw" : "freeze")}>{state === "frozen" ? <Sun className="h-3.5 w-3.5" aria-hidden /> : <Snowflake className="h-3.5 w-3.5" aria-hidden />} {state === "frozen" ? "Ontdooien" : "Bevriezen"}</Button>
        <Button variant="destructive" size="sm" className="gap-1.5" disabled={busy !== null || state === "blocked"} onClick={() => setConfirm("block")}><Ban className="h-3.5 w-3.5" aria-hidden /> Blokkeren</Button>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => setConfirm("replace")}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Vervangen</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Elke actie vraagt een nieuwe controle met je passkey, sms, herstelcode of wachtwoord, geldt maar één keer en komt in je activiteitenlog.</p>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM[confirm ?? "block"].title}</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM[confirm ?? "block"].body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); void (c === "block" ? doBlock() : c === "replace" ? doReplace() : doFreeze(c === "freeze")); }}>{CONFIRM[confirm ?? "block"].action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
