import type { ReactNode } from 'react';

const signedIn = !document.cookie.split('; ').includes('preview-signed-out=1');
const auth = {
  user: signedIn ? { id: 'local', email: 'local@localhost' } : null,
  isLoading: false,
  // The preview server swaps in a real signed token, so the broker API still checks it.
  getAccessToken: async () => (signedIn ? 'local' : ''),
  signIn: async () => {},
  signOut: () => {},
};

export const AuthKitProvider = ({ children }: { children: ReactNode }) => children;
export const useAuth = () => auth;
