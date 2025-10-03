import { registerSingletonWindowListener, registerWindowListener } from '../window-listeners';

describe('window listeners', () => {
  it('registerWindowListener registers and unregisters handlers', () => {
    const handler = jest.fn();
    const dispose = registerWindowListener('tldraw:test-event', handler);

    window.dispatchEvent(new Event('tldraw:test-event'));
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
    window.dispatchEvent(new Event('tldraw:test-event'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('registerSingletonWindowListener replaces existing handler', () => {
    const first = jest.fn();
    const second = jest.fn();

    const disposeFirst = registerSingletonWindowListener(
      '__listener_flag__',
      'tldraw:singleton',
      first,
    );
    const disposeSecond = registerSingletonWindowListener(
      '__listener_flag__',
      'tldraw:singleton',
      second,
    );

    window.dispatchEvent(new Event('tldraw:singleton'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    disposeSecond();
    window.dispatchEvent(new Event('tldraw:singleton'));
    expect(second).toHaveBeenCalledTimes(1);

    disposeFirst();
  });
});
