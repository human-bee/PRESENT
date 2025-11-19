import z from 'zod';
export const SimpleColor = z.enum([
    'red',
    'light-red',
    'green',
    'light-green',
    'blue',
    'light-blue',
    'orange',
    'yellow',
    'black',
    'violet',
    'light-violet',
    'grey',
    'white',
]);
export function asColor(color) {
    if (SimpleColor.safeParse(color).success) {
        return color;
    }
    switch (color) {
        case 'pink': {
            return 'light-violet';
        }
        case 'light-pink': {
            return 'light-violet';
        }
    }
    return 'black';
}
//# sourceMappingURL=SimpleColor.js.map