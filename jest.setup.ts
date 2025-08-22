import '@testing-library/jest-dom';

// Polyfill TextEncoder/TextDecoder for environment where not available
import { TextEncoder, TextDecoder } from 'util';

if (typeof (global as any).TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder as any;
}
if (typeof (global as any).TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder as any;
}