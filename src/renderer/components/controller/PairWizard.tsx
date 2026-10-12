import { useCallback, useEffect, useState } from 'react';
import type { PairEvent } from '@shared/types';
import { api } from '../../api';
import { isPadDualSense } from '../../input/input';
import type { InputEvent } from '../../input/actions';
import { play } from '../../sound/sfx';
import { useStore } from '../../state/store';
import { ButtonHints } from '../ButtonHints';
import { Modal } from './Modal';

type Step = 'intro' | 'searching' | 'done' | 'failed' | 'manual';

/**
 * Bluetooth pairing from inside Arcadia. Best started with the controller on
 * a USB-C cable: it works over the cable immediately, so the whole flow is
 * controller-driven. Without the native helper, falls back to a guided
 * System Settings flow and watches for the controller to appear.
 */
export function PairWizard({ onClose }: { onClose(): void }) {
  const helper = useStore((s) => s.controller.helper);
  const [step, setStep] = useState<Step>(helper === 'running' ? 'intro' : 'manual');
  const [event, setEvent] = useState<PairEvent | null>(null);
  const [choice, setChoice] = useState(0);

  useEffect(
    () =>
      api.on('controller:pair', (e) => {
        setEvent(e);
        if (e.phase === 'connected') {
          play('confirm');
          setStep('done');
        } else if (e.phase === 'failed' || e.phase === 'timeout') {
          play('error');
          setStep('failed');
        }
      }),
    [],
  );

  // Manual flow: notice the controller arriving through the Gamepad API.
  useEffect(() => {
    if (step !== 'manual') return;
    const onConnect = (e: GamepadEvent): void => {
      if (isPadDualSense(e.gamepad.id) || e.gamepad.mapping === 'standard') {
        play('confirm');
        setStep('done');
      }
    };
    window.addEventListener('gamepadconnected', onConnect);
    return () => window.removeEventListener('gamepadconnected', onConnect);
  }, [step]);

  const start = useCallback(() => {
    setEvent(null);
    setStep('searching');
    void api.invoke('controller:pair');
  }, []);

  const close = useCallback(() => {
    if (step === 'searching') void api.invoke('controller:cancelPair');
    onClose();
  }, [step, onClose]);

  const actions: { label: string; run(): void }[] =
    step === 'intro' ? [{ label: 'Start pairing', run: start }, { label: 'Use System Settings instead', run: () => setStep('manual') }]
    : step === 'failed' ? [{ label: 'Try again', run: start }, { label: 'Use System Settings instead', run: () => setStep('manual') }]
    : step === 'manual' ? [{ label: 'Open Bluetooth Settings', run: () => void api.invoke('system:openSettingsPane', 'bluetooth') }, ...(helper === 'running' ? [{ label: 'Pair from Arcadia', run: start }] : [])]
    : step === 'done' ? [{ label: 'Done', run: onClose }]
    : [{ label: 'Cancel', run: close }];

  const onInput = useCallback(
    (e: InputEvent) => {
      if (e.kind === 'repeat') return;
      if (e.action === 'back' && e.kind === 'press') {
        play('back');
        close();
      } else if ((e.action === 'up' || e.action === 'down' || e.action === 'left' || e.action === 'right') && e.kind === 'press') {
        const d = e.action === 'down' || e.action === 'right' ? 1 : -1;
        setChoice((c) => Math.max(0, Math.min(actions.length - 1, c + d)));
        play('move');
      } else if (e.action === 'confirm' && e.kind === 'release') {
        play('confirm');
        actions[Math.min(choice, actions.length - 1)]?.run();
        setChoice(0);
      }
    },
    [actions, choice, close],
  );

  return (
    <Modal title="Pair a wireless controller" onInput={onInput} footer={<ButtonHints hints={[{ button: 'south', label: 'Select' }, { button: 'east', label: 'Close' }]} />}>
      <div className="pair">
        <div className="pair-visual" data-step={step}>
          <div className="pair-pad">
            <span className="pair-light" />
          </div>
          {step === 'searching' && <div className="pair-pulse" />}
        </div>
        <div className="pair-text">
          {step === 'intro' && (
            <ol className="steps">
              <li>Tip: plug the controller in with a USB-C cable first, so you can use it while it pairs. A keyboard works too.</li>
              <li>
                Press <b>Start pairing</b>, then hold <b>Create</b> (small button left of the touchpad) and <b>Home</b> together until the light bar flashes quickly.
              </li>
              <li>Unplug the cable when Arcadia says it’s connected.</li>
            </ol>
          )}
          {step === 'searching' && (
            <p className="status-line">
              {event?.phase === 'pairing' || event?.phase === 'found' ? `Pairing with ${event.name ?? 'controller'}…` : 'Searching… hold Create + Home until the light flashes quickly.'}
            </p>
          )}
          {step === 'done' && <p className="status-line ok">Connected{event?.name ? `: ${event.name}` : ''}. You can unplug the cable now.</p>}
          {step === 'failed' && <p className="status-line error">{event?.message ?? 'Pairing didn’t finish.'}</p>}
          {step === 'manual' && (
            <ol className="steps">
              <li>Hold <b>Create</b> + <b>Home</b> until the light bar flashes quickly.</li>
              <li>In System Settings → Bluetooth, click <b>Connect</b> next to “DualSense Wireless Controller”.</li>
              <li>Arcadia will notice it connect.</li>
            </ol>
          )}
          <div className="pair-actions">
            {actions.map((a, i) => (
              <button key={a.label} className="pill" data-focused={i === Math.min(choice, actions.length - 1)} onClick={a.run}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
