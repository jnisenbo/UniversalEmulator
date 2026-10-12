import type { EmulatorId } from '@shared/platforms';
import type { EmulatorAdapter } from './adapter';
import { dolphinAdapter } from './dolphin/adapter';
import { ryubingAdapter } from './ryubing/adapter';
import { xemuAdapter } from './xemu/adapter';
import { xeniaAdapter } from './xenia/adapter';

const ADAPTERS: Record<EmulatorId, EmulatorAdapter> = {
  dolphin: dolphinAdapter,
  ryubing: ryubingAdapter,
  xemu: xemuAdapter,
  xenia: xeniaAdapter,
};

export const getAdapter = (id: EmulatorId): EmulatorAdapter => ADAPTERS[id];
export const allAdapters = (): EmulatorAdapter[] => Object.values(ADAPTERS);
