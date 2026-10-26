import { useEffect, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { useLocale } from './locale';

function SignInButton() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={isLoading}
        onClick={() => {
          const path = window.location.pathname;
          if (/^(?:\/|\/stocks|\/t\/[A-Z0-9-]+)$/.test(path))
            window.sessionStorage.setItem('vibe-idx-return-to', path);
          void signIn().catch(() => setFailed(true));
        }}
      >
        {t('Sign in')}
      </button>
      {failed ? <p role="alert">{t('Could not sign in. Try again.')}</p> : null}
    </>
  );
}

export function AccountControls() {
  const { user, signOut } = useAuth();
  const { t } = useLocale();
  return user ? (
    <>
      <span>{user.email}</span>
      <button type="button" onClick={() => signOut({ returnTo: window.location.origin })}>
        {t('Sign out')}
      </button>
    </>
  ) : (
    <SignInButton />
  );
}

export function LoginPage() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isLoading) void signIn().catch(() => setFailed(true));
  }, [isLoading, signIn]);
  return failed ? (
    <div role="alert">
      {t('Could not sign in. Try again.')} <SignInButton />
    </div>
  ) : (
    <p role="status">{t('Signing you in…')}</p>
  );
}
