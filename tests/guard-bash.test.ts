import { describe, expect, it } from 'vitest';
import { checkBash } from '../src/guard-bash';

const bash = (command: string) => checkBash(command).ok;

describe('Bash', () => {
  it('อนุญาตคำสั่งทั่วไป', () => {
    expect(bash('npm test')).toBe(true);
  });

  it.each([
    'rm -rf node_modules',
    'rm -fr build',
    'rm --recursive dist',
    'git push origin main',
    'git commit -m x',
    'git reset --hard',
    'npm publish',
    'sudo apt install x',
    'Remove-Item -Recurse -Force build',
  ])('บล็อก: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['git status', 'git diff --stat', 'git log -5'])('อนุญาต git อ่านอย่างเดียว: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: git global options (finding 1)', () => {
  it.each([
    'git -C . push',
    'git -C ../x push',
    'git -C /abs/repo push',
    'git -C ./sub commit -m x',
    'cd x && git -C . push origin',
    'git -C "my dir" push',
    'git -c core.pager=cat push',
    'git --git-dir=.git push',
    'git --git-dir .git --work-tree . commit -m x',
    'git --no-pager -C src add .',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each([
    'git -C src status',
    'git -c core.pager=cat log',
    'git --no-pager -C src log',
    'git --no-pager diff --stat',
    'git --git-dir=.git --work-tree=. status',
    'git --version',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });

  it('deny reason names the real subcommand, not the -C argument', () => {
    const v = checkBash('git -C src commit -m x');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain('commit');
      expect(v.reason).not.toContain('git src');
    }
  });
});

describe('Bash: rm recursive/force anywhere in args (finding 2)', () => {
  it.each([
    'rm -v -r x',
    'rm -i -r x',
    'rm x -rf',
    'rm dir -R',
    'rm --no-preserve-root -r /',
    'RM -Rf x',
    'rm.exe -rf x',
    'rm -rf node_modules',
    'rm -fr build',
    'rm --recursive dist',
    'rm -r -f x',
    'rm --rec dist',
    'rm --force x',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['rm x.txt', 'rm -v x.txt', 'rm -i x.txt', 'echo rm -rf'])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: Windows/PowerShell delete forms (finding 3)', () => {
  it.each([
    'rmdir /q /s x',
    'rmdir x /s',
    'rd /s /q x',
    'erase /s x',
    'del /s x',
    'del x /q',
    'Remove-Item x -r',
    'ri x -r',
    'ri x -Recurse',
    'del x -Recurse',
    'Remove-Item -Recurse -Force build',
    'remove-item build -rec',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['rmdir x', 'del x.txt', 'Remove-Item x.txt', 'ri x.txt -Force'])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: executable spelling (finding 4)', () => {
  it.each([
    '"git" push',
    "'git' commit -m x",
    'GIT push',
    'git.exe push',
    '"C:/Program Files/Git/bin/git.exe" push',
    '"C:\\Program Files\\Git\\bin\\git.exe" push',
    '/usr/bin/git commit -m x',
    'SUDO apt install x',
    '/usr/bin/sudo ls',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['GIT status', 'git.exe status', '"C:/Program Files/Git/bin/git.exe" status'])(
    'allow: %s',
    (command) => {
      expect(bash(command)).toBe(true);
    },
  );
});

describe('Bash: npm/pnpm/yarn publish|login|adduser (finding 5)', () => {
  it.each([
    'npm publish',
    'npm --silent publish',
    'npm -w a publish',
    'npm --workspace=a publish',
    'npm.cmd publish',
    'pnpm publish',
    'pnpm -r publish',
    'pnpm --filter x publish',
    'yarn publish',
    'npm login',
    'npm adduser',
    'NPM PUBLISH',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['npm run publish', 'npm test', 'npm -w a run build', 'pnpm install', 'yarn build'])(
    'allow: %s',
    (command) => {
      expect(bash(command)).toBe(true);
    },
  );
});

describe('Bash: quoted prose is an argument, not a command (finding 6)', () => {
  it.each([
    'echo "use git to commit"',
    'grep -r "git init" docs',
    'git log --grep="git bisect"',
    'my-git push',
    'echo "please do not use sudo"',
    "echo 'rm -rf /'",
    "echo '$(git push)'",
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });

  it.each(['sudo apt install x', 'ls && sudo rm x', 'echo hi; sudo ls'])(
    'deny sudo as a command word: %s',
    (command) => {
      expect(bash(command)).toBe(false);
    },
  );
});

describe('Bash: chains, substitutions and wrappers', () => {
  it.each([
    'git status && git push',
    'git status; git commit -m x',
    'git status || git push',
    'git status | git commit -F -',
    'git status\ngit push',
    'git status & git push',
    'npm test && rm -rf dist',
    '(git push)',
    'echo "$(git push)"',
    'echo `git push`',
    'echo $(rm -rf x)',
    'FOO=1 git push',
    'env git push',
    'xargs -I {} rm -rf {}',
    'bash -c "git push"',
    'sh -c "npm test && git commit -m x"',
    'powershell -Command "Remove-Item x -Recurse"',
    'cmd /c rmdir /s /q x',
    'eval "git push"',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each([
    'git status && git diff',
    'git status; git log -3',
    'npm test && npm run build',
    'FOO=1 git status',
    'bash -c "git status"',
    'echo "a && b; c | d"',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix wave 2: regressions vs. regex-anywhere, legitimate commands, nesting
// ---------------------------------------------------------------------------
describe('Bash: find -exec / -delete', () => {
  it.each([
    'find . -exec rm -rf {} +',
    'find . -name x -exec rm -r {} \\;',
    'find . -exec git push \\;',
    'find . -delete',
    'find . -execdir git commit -m x \\;',
    'find . -ok rm -rf {} \\;',
    'find . -okdir git push \\;',
    'find . -exec echo {} \\; -exec git push \\;',
    'find . -exec sh -c "git push" \\;',
    'env find . -delete',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each([
    'find . -name "*.ts"',
    'find src -type f -exec cat {} +',
    'find . -exec grep -l foo {} \\;',
    'find . -name "*.ts" | xargs wc -l',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: leading redirection words', () => {
  it.each([
    '>/dev/null git push',
    '2>&1 git push',
    '>out.txt rm -rf x',
    '</dev/null git commit -m x',
    '> out.txt git push',
    'FOO=1 >/dev/null git push',
    '2>/dev/null sudo ls',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each(['>/dev/null git status', '2>&1 npm test', '> out.txt echo hi'])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: package runners', () => {
  it.each([
    'npx git push',
    'npm exec -- rm -rf x',
    'pnpm exec git push',
    'yarn exec git push',
    'pnpm dlx rm -rf x',
    'npx -y git push',
    'npx --package foo git push',
    'npm exec --workspace a -- git commit -m x',
    'pnpm --filter x exec git push',
    'npx -c "git push"',
    'npx npm publish',
    'npx.cmd git push',
  ])('deny: %s', (command) => {
    expect(bash(command)).toBe(false);
  });

  it.each([
    'npx vitest run tests/x.test.ts',
    'npx tsc --noEmit',
    'npm exec -- vitest run',
    'pnpm exec tsc',
    'npx -y prettier --check .',
    'pnpm dlx create-vite',
    'npx git status',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });
});

describe('Bash: git --attr-source takes a value', () => {
  it('denies the real subcommand behind --attr-source', () => {
    expect(bash('git --attr-source HEAD push')).toBe(false);
    expect(bash('git --attr-source HEAD status')).toBe(true);
  });
});

describe('Bash: substitutions are opaque words, not separators', () => {
  it.each(['git -C `pwd` push', 'git -C $(pwd) push', 'git -C $(git rev-parse --show-toplevel) push'])(
    'deny: %s',
    (command) => {
      expect(bash(command)).toBe(false);
    },
  );

  it.each([
    'git -C `pwd` status',
    'git -C $(pwd) status',
    'git -C `git rev-parse --show-toplevel` status',
    'echo `echo hi`',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });

  it('still re-checks the body of a backtick substitution', () => {
    expect(bash('echo `git push`')).toBe(false);
    expect(bash('`git push`')).toBe(false);
    expect(bash('echo `echo $(rm -rf x)`')).toBe(false);
  });
});

describe('Bash: legitimate everyday commands stay allowed', () => {
  it.each([
    'npm test 2>&1 | head',
    'cd sub && npm test',
    'npm install',
    'npx vitest run tests/x.test.ts',
    'python -m pytest',
    'git -C "my dir" status',
    'git status',
    'git diff --stat',
    'npm run build',
    'node script.js',
    'npm test -- --reporter=verbose',
    'git log -5 --oneline',
  ])('allow: %s', (command) => {
    expect(bash(command)).toBe(true);
  });

  it('rm -f is still a deny', () => {
    expect(bash('rm -f x.txt')).toBe(false);
  });
});

describe('Bash: nesting limit', () => {
  const nest = (levels: number) => `${'echo $('.repeat(levels)}echo hi${')'.repeat(levels)}`;

  it('allows shallow nesting', () => {
    expect(bash(nest(2))).toBe(true);
  });

  it('denies deeply nested $(...) with the nesting reason', () => {
    const v = checkBash(nest(8));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('ซ้อน');
  });

  it('denies deeply chained eval', () => {
    expect(bash(`${'eval '.repeat(8)}echo hi`)).toBe(false);
  });
});
