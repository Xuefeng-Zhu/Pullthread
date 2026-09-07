import type { CommerceConfig } from './config';
import { CommerceError } from './errors';
import type { NativeCommerceRuntime } from './nativeService';

/** Web never loads Firebase Auth or a native purchase module. */
export async function loadNativeRuntime(_config: CommerceConfig): Promise<NativeCommerceRuntime> {
  throw new CommerceError('Points purchases are available in the iPhone and Android apps.', 'unavailable');
}
