import { customAlphabet } from 'nanoid';
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(alphabet, 12);
export function newAgentShapeId() {
    return `ag:${nano()}`;
}
//# sourceMappingURL=ids.js.map