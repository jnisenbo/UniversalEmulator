import type { EmulatorId } from '@shared/platforms';
import type { EmulatorAdapter } from './adapter';
import { dolphinAdapter } from './dolphin/adapter';
import { ryubingAdapter } from './ryubing/adapter';
import { xemuAdapter } from './xemu/adapter';
import { xeniaAdapter } from './xenia/adapter';
import { pcsx2Adapter } from './pcsx2/adapter';
import { rpcs3Adapter } from './rpcs3/adapter';
import { retroarchAdapter } from './retroarch/adapter';

const ADAPTERS: Record<EmulatorId, EmulatorAdapter> = {
  dolphin: dolphinAdapter,
  ryubing: ryubingAdapter,
  xemu: xemuAdapter,
  xenia: xeniaAdapter,
  pcsx2: pcsx2Adapter,
  rpcs3: rpcs3Adapter,
  retroarch: retroarchAdapter,
};

export const getAdapter = (id: EmulatorId): EmulatorAdapter => ADAPTERS[id];
export const allAdapters = (): EmulatorAdapter[] => Object.values(ADAPTERS);
