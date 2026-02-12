import { createLogger } from '@/lib/logging';

describe('logger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LOG_LEVEL = 'debug';
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'development';
    window.localStorage.removeItem('present:logLevel');
    window.localStorage.removeItem('present:debugNamespaces');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('logs info at debug level', () => {
    const logger = createLogger('test');
    logger.info('hello', { value: 1 });

    expect(console.log).toHaveBeenCalled();
  });

  it('respects once key', () => {
    const logger = createLogger('test');
    logger.once('dup', 'hello');
    logger.once('dup', 'hello');

    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('merges child object context', () => {
    const logger = createLogger('test', { scope: 'a' }).child({ reqId: '1' });
    logger.error('boom', { extra: true });

    expect(console.error).toHaveBeenCalledWith(
      '[present] [test]',
      'boom',
      expect.objectContaining({ scope: 'a', reqId: '1', extra: true }),
    );
  });
});
