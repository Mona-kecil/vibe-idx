import type { ReactNode } from 'react';

const auth = {
  user: { id: 'hillclimb', email: 'hillclimb@localhost' },
  isLoading: false,
  getAccessToken: async () => 'hillclimb',
  signIn: async () => {},
  signOut: () => {},
};

export const AuthKitProvider = ({ children }: { children: ReactNode }) => children;
export const useAuth = () => auth;
