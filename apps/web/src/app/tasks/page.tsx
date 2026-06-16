import { redirect } from 'next/navigation';

// The mission-control board folded into the unified command center at "/".
export default function TasksRedirect() {
  redirect('/');
}
