import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronDown, Settings, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useLocation, Link } from "wouter";
import { getUserInfoFromMsalAccount } from "@/utils/msal-user";
import { useEffect, useState } from "react";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { getKeycloakAccount, loginWithKeycloak, logoutKeycloak } from "@/utils/keycloak-auth";

export function UserMenu() {
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();
  const amplifyAuth = useAmplifyAuthOptional();
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [, setLocation] = useLocation();
  const [userInfo, setUserInfo] = useState<{
    name: string;
    email: string;
    displayName?: string;
  } | null>(null);

  useEffect(() => {
    if (isKeycloak) {
      const account = getKeycloakAccount();
      if (account) {
        setUserInfo({
          name: account.displayName,
          email: account.email,
          displayName: account.displayName,
        });
      } else {
        setUserInfo(null);
      }
      return;
    }
    if (isAmp) {
      const u = amplifyAuth?.user;
      if (u) {
        setUserInfo({
          name: u.name,
          email: u.email,
          displayName: u.name,
        });
      } else {
        setUserInfo(null);
      }
      return;
    }
    if (isAuthenticated && accounts.length > 0) {
      const info = getUserInfoFromMsalAccount(accounts[0]);
      if (info) {
        setUserInfo({
          name: info.name,
          email: info.email,
          displayName: info.displayName,
        });
      }
    } else {
      setUserInfo(null);
    }
  }, [isKeycloak, isAmp, amplifyAuth?.user, isAuthenticated, accounts]);

  const handleLogin = async () => {
    if (isAmp) {
      await amplifyAuth?.signInWithMicrosoft();
      return;
    }
    if (isKeycloak) {
      await loginWithKeycloak();
      return;
    }
    setLocation("/overview");
  };

  const handleLogout = async () => {
    sessionStorage.removeItem("mfa_verified");
    if (isAmp) {
      await amplifyAuth?.signOutApp();
      setLocation("/");
      return;
    }
    if (isKeycloak) {
      logoutKeycloak();
      return;
    }
    try {
      await instance.logoutPopup({
        account: accounts[0],
      });
      setLocation("/");
    } catch (error) {
      console.error("Logout failed:", error);
      setLocation("/");
    }
  };

  const showSignIn = isAmp
    ? !amplifyAuth?.isLoading && !amplifyAuth?.user
    : isKeycloak
      ? !userInfo
      : !isAuthenticated || !userInfo;

  if (isAmp && amplifyAuth?.isLoading) {
    return null;
  }

  if (showSignIn) {
    return (
      <Button onClick={handleLogin} variant="default" data-testid="button-sign-in">
        Sign In
      </Button>
    );
  }

  if (!userInfo) {
    return (
      <Button onClick={handleLogin} variant="default" data-testid="button-sign-in">
        Sign In
      </Button>
    );
  }

  const displayName = userInfo.displayName || userInfo.name || userInfo.email || "User";
  const email = userInfo.email || "";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2" data-testid="button-user-menu">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="hidden md:block text-left">
            <div className="text-sm font-medium">{displayName}</div>
            <div className="text-xs text-muted-foreground">{email}</div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="menu-profile-setup" asChild>
          <Link href="/profile-setup" className="flex items-center w-full">
            <User className="mr-2 h-4 w-4" />
            Profile Setup
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="menu-settings" asChild>
          <Link href="/settings" className="flex items-center w-full">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
