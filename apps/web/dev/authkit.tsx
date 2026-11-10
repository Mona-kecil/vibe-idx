import type { ReactNode } from 'react';

const auth = {
  user: { id: 'fixtures', email: 'fixtures@localhost' },
  isLoading: false,
  getAccessToken: async (): Promise<string> => import.meta.env.VITE_FIXTURE_TOKEN,
  signIn: async () => {},
  signOut: () => {},
};

export const AuthKitProvider = ({ children }: { children: ReactNode }) => children;
export const useAuth = () => auth;
