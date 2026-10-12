// CI step: fails a pull request during the holiday change freeze, unless the PR carries the
// `freeze-exception` label (FREEZE_EXCEPTION=true). Outside the freeze it prints the next one.
import { currentFreeze, freezeStart } from './freeze';

const now = new Date();
const freeze = currentFreeze(now);

if (!freeze) {
  console.log(`No change freeze now. The next one starts ${freezeStart(now.getUTCFullYear()).toISOString()}.`);
} else if (process.env.FREEZE_EXCEPTION === 'true') {
  console.log(`Holiday change freeze until ${freeze.end.toISOString()}, but this PR has the freeze-exception label.`);
} else {
  console.log(
    `::error::Holiday change freeze from ${freeze.start.toISOString()} until ${freeze.end.toISOString()}. ` +
    'Only fixes the owner approves ship now: add the freeze-exception label to this PR to let it through.'
  );
  process.exit(1);
}
