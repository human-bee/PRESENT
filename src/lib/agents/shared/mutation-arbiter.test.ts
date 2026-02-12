import { MutationArbiter } from './mutation-arbiter';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MutationArbiter', () => {
  test('serializes mutations with the same lock key', async () => {
    const arbiter = new MutationArbiter();
    const steps: string[] = [];

    const first = arbiter.run(
      { idempotencyKey: 'id-a', lockKey: 'component:1' },
      async () => {
        steps.push('a:start');
        await sleep(20);
        steps.push('a:end');
      },
    );

    const second = arbiter.run(
      { idempotencyKey: 'id-b', lockKey: 'component:1' },
      async () => {
        steps.push('b:start');
        await sleep(1);
        steps.push('b:end');
      },
    );

    await Promise.all([first, second]);
    expect(steps).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('allows parallel mutations for different lock keys', async () => {
    const arbiter = new MutationArbiter();
    let active = 0;
    let overlapped = false;

    const runTask = (idempotencyKey: string, lockKey: string) =>
      arbiter.run({ idempotencyKey, lockKey }, async () => {
        active += 1;
        if (active > 1) {
          overlapped = true;
        }
        await sleep(20);
        active -= 1;
      });

    await Promise.all([
      runTask('id-1', 'component:one'),
      runTask('id-2', 'component:two'),
    ]);

    expect(overlapped).toBe(true);
  });

  test('dedupes mutations with the same idempotency key', async () => {
    const arbiter = new MutationArbiter();
    let executions = 0;

    const first = await arbiter.run(
      { idempotencyKey: 'same-id', lockKey: 'component:1' },
      async () => {
        executions += 1;
      },
    );

    const second = await arbiter.run(
      { idempotencyKey: 'same-id', lockKey: 'component:1' },
      async () => {
        executions += 1;
      },
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(executions).toBe(1);
  });
});
