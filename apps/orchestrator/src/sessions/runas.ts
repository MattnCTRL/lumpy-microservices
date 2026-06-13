import { execFileSync } from 'node:child_process';

export interface RunAs {
  user: string;
  uid: number;
  gid: number;
  home: string;
}

/** Resolve a system user's uid/gid/home from the passwd database. */
export function resolveRunAs(user: string): RunAs {
  // getent passwd <user> -> name:passwd:uid:gid:gecos:home:shell
  const fields = execFileSync('getent', ['passwd', user]).toString().trim().split(':');
  return {
    user,
    uid: Number(fields[2]),
    gid: Number(fields[3]),
    home: fields[5] || `/home/${user}`,
  };
}

/** Environment for a process running as the given user (so HOME/creds resolve). */
export function runAsEnv(runAs: RunAs): NodeJS.ProcessEnv {
  return { ...process.env, HOME: runAs.home, USER: runAs.user, LOGNAME: runAs.user };
}
