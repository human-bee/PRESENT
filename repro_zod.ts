import z from 'zod';

try {
    const schema = z.object({ foo: z.string() });
    if ('meta' in schema) {
        console.log('meta exists on schema');
    } else {
        console.log('meta does NOT exist on schema');
    }
    // @ts-ignore
    schema.meta({ title: 'Test' });
    console.log('meta call succeeded');
} catch (e) {
    console.error('meta call failed:', e.message);
}
