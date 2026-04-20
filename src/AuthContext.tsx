import { createContext, useContext } from "react";
import type { User } from "firebase/auth";

const AuthUserContext = createContext<User | null>(null);

export function useAuthUser(): User | null {
  return useContext(AuthUserContext);
}

export const AuthUserProvider = AuthUserContext.Provider;
