import { MutationArbiter } from '../mutation-arbiter';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MutationArbiter', () => {
  it('serializes mutations for the same lockKey', async () => {
    const arbiter = new MutationArbiter();
    const trace: string[] = [];

    await Promise.all([
      arbiter.execute({ lockKey: 'widget:1' }, async () => {
        trace.push('A:start');
        await delay(20);
        trace.push('A:end');
        return 'A';
      }),
      arbiter.execute({ lockKey: 'widget:1' }, async () => {
        trace.push('B:start');
        await delay(1);
        trace.push('B:end');
        return 'B';
      }),
    ]);

    expect(trace).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('allows parallel mutations for different lock keys', async () => {
    const arbiter = new MutationArbiter();
    let aEnded = false;
    let bStartedBeforeAEnd = false;

    await Promise.all([
      arbiter.execute({ lockKey: 'widget:A' }, async () => {
        await delay(25);
        aEnded = true;
        return 'A';
      }),
      arbiter.execute({ lockKey: 'widget:B' }, async () => {
        bStartedBeforeAEnd = !aEnded;
        await delay(1);
        return 'B';
      }),
    ]);

    expect(bStartedBeforeAEnd).toBe(true);
  });

  it('dedupes repeated idempotency keys for the same lock key', async () => {
    const arbiter = new MutationArbiter();
    let executions = 0;

    const first = await arbiter.execute(
      { lockKey: 'widget:dup', idempotencyKey: 'same-key' },
      async () => {
        executions += 1;
        return { status: 'ok' };
      },
    );
    const second = await arbiter.execute(
      { lockKey: 'widget:dup', idempotencyKey: 'same-key' },
      async () => {
        executions += 1;
        return { status: 'should_not_run' };
      },
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(executions).toBe(1);
  });
});

