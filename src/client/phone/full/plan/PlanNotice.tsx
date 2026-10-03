// "The game went back, so your plan was dropped.": a short line on this phone only, after the game dropped a plan.
import {TimedNotice} from '../../../ui/UndoNotice';
import {usePlans} from './store';

export function PlanNotice() {
  const n = usePlans((s) => s.notice);
  return <TimedNotice at={n?.at ?? null} text={n?.text ?? ''} testId="plan-notice" />;
}
