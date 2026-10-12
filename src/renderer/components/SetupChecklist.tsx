import { EMULATOR_IDS } from '@shared/platforms';
import { useStore } from '../state/store';

export interface SetupStep {
  id: 'emulators' | 'library' | 'controller';
  label: string;
  detail: string;
  done: boolean;
}

export function useSetupSteps(): SetupStep[] {
  const settings = useStore((s) => s.settings);
  const controller = useStore((s) => s.controller);
  const games = useStore((s) => s.games);
  const ready = EMULATOR_IDS.filter((id) => settings?.emulators[id].appPath).length;
  return [
    { id: 'emulators', label: 'Install emulators', detail: ready ? `${ready} of ${EMULATOR_IDS.length} ready. Install the rest in one step.` : 'One step: Arcadia downloads the official Mac builds for you.', done: ready > 0 },
    { id: 'library', label: 'Add your game folders', detail: games.length ? `${games.length} games found` : 'Point Arcadia at the folders with your own game dumps.', done: games.length > 0 },
    { id: 'controller', label: 'Connect your controller', detail: controller.controllers.length ? `${controller.controllers[0]!.name} connected` : 'Pair it over Bluetooth from Settings → Controller.', done: controller.controllers.length > 0 },
  ];
}

/** First-run guide on the empty home screen. */
export function SetupChecklist({ steps, focused }: { steps: SetupStep[]; focused: number }) {
  return (
    <ol className="checklist">
      {steps.map((s, i) => (
        <li key={s.id} className="check-item" data-done={s.done} data-focused={i === focused}>
          <span className="check-mark">{s.done ? '✓' : i + 1}</span>
          <span>
            <span className="check-label">{s.label}</span>
            <span className="check-detail">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
