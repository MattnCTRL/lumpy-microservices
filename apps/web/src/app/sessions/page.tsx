import { redirect } from 'next/navigation';

// Sessions are now cards in the unified command center at "/" (tap a card to open
// its full conversation). This route redirects there so old links keep working.
export default function SessionsRedirect() {
  redirect('/');
}
