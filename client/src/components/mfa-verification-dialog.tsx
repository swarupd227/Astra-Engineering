import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, LogOut } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { getMsalInstance } from "@/utils/api-interceptor";

export function MfaVerificationDialog({ user }: { user: any }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const isVerifiedInSession = sessionStorage.getItem('mfa_verified') === 'true';
    if (user?.isMfaEnabled && !isVerifiedInSession) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [user]);

  const verifyMfaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/mfa/verify", { 
        userId: user.id, 
        token 
      });
      return response.json();
    },
    onSuccess: () => {
      sessionStorage.setItem('mfa_verified', 'true');
      setOpen(false);
      setToken("");
      toast({ title: "Verification Successful", description: "You are logged in securely." });
    },
    onError: (error: any) => {
      toast({ title: "Verification Failed", description: error.message || "Invalid code", variant: "destructive" });
    }
  });

  const handleLogout = useCallback(async () => {
    try {
      if (isAmplifyAuthMode()) {
        const { signOut } = await import("aws-amplify/auth");
        await signOut();
        sessionStorage.removeItem("mfa_verified");
      } else {
        const msal = getMsalInstance();
        if (msal) {
          const accounts = msal.getAllAccounts();
          if (accounts.length > 0) {
            await msal.logoutPopup({ account: accounts[0] });
          }
        }
      }
    } catch (error) {
      console.error("Logout failed:", error);
    }
    setLocation("/");
    setOpen(false);
  }, [setLocation]);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-md [&>button]:hidden bg-background border-2 border-primary/20 shadow-2xl"
      >
        <DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="rounded-full bg-primary/10 p-3">
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-bold tracking-tight">Two-Step Verification</DialogTitle>
          </div>
          <DialogDescription className="text-center text-sm">
            Your account is protected by Multi-Factor Authentication. Please enter the 6-digit code from your Authenticator app.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col space-y-4 pt-4 px-2">
          <Input 
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="000000"
            maxLength={6}
            autoFocus
            className="text-center text-2xl tracking-[0.5em] h-14"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.length === 6 && !verifyMfaMutation.isPending) {
                verifyMfaMutation.mutate();
              }
            }}
          />
          <div className="flex justify-between items-center pt-2">
            <Button variant="ghost" className="text-muted-foreground" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
            <Button 
              onClick={() => verifyMfaMutation.mutate()} 
              disabled={token.length !== 6 || verifyMfaMutation.isPending}
              className="px-8"
            >
              {verifyMfaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {verifyMfaMutation.isPending ? "Verifying..." : "Verify"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
