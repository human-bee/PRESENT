import * as kernel from '@present/kernel';

export async function hydrateResetKernel() {
  await kernel.ensureResetKernelHydrated?.();
}

export async function flushResetKernelWrites() {
  await kernel.flushResetPersistenceMirrors?.();
}
