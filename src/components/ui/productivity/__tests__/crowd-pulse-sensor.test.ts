type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createMockStream(): MediaStream {
  const track = { stop: jest.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe('crowd-pulse sensor startup cancellation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('starts a fresh sensor startup after quick unsubscribe and resubscribe churn', async () => {
    const firstStart = createDeferred<MediaStream>();
    const secondStart = createDeferred<MediaStream>();
    const getUserMedia = jest
      .fn<Promise<MediaStream>, [MediaStreamConstraints]>()
      .mockReturnValueOnce(firstStart.promise)
      .mockReturnValueOnce(secondStart.promise);

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });

    const { subscribeCrowdPulseSensor } = await import('../crowd-pulse-sensor');

    const unsubscribeFirst = subscribeCrowdPulseSensor(jest.fn(), jest.fn());
    unsubscribeFirst();

    const unsubscribeSecond = subscribeCrowdPulseSensor(jest.fn(), jest.fn());

    expect(getUserMedia).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    firstStart.resolve(createMockStream());
    secondStart.resolve(createMockStream());
    await Promise.resolve();
    await Promise.resolve();
  });
});
