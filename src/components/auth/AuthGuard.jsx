import { useAuth } from "../../lib/auth/context.jsx";

/* AuthGuard — wraps protected views.
   If unauthenticated, renders the fallback (login view) instead.
   Does NOT rely solely on hiding an entry button. */

export default function AuthGuard({ children, fallback }) {
  const { authenticated } = useAuth();

  if (!authenticated) {
    return fallback || null;
  }

  return children;
}
