/** Whether the opening animation (components/SplashIntro.tsx) has finished, so nothing (the tour) opens over it. */
let finished = false;
const waiting: (() => void)[] = [];

export function introFinished(): void {
  finished = true;
  waiting.splice(0).forEach((resolve) => resolve());
}

/** Resolves once the opening animation is gone (at once if it already is). */
export function afterIntro(): Promise<void> {
  return finished ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve));
}
