import { createContext, useContext, ReactNode, useState, useMemo, useCallback } from "react";

type AuthContextType = {
  isLoggedIn: boolean;
  user: { email: string; name: string } | null;
  login: (email: string, name: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);

  const isLoggedIn = user !== null;

  const login = useCallback((email: string, name: string) => {
    setUser({ email, name });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ isLoggedIn, user, login, logout }),
    [isLoggedIn, user, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};
