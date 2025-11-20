export const CONTEXT_TYPE_DEFINITIONS = {
    shape: {
        icon: 'target',
        name: (item) => {
            let name = item.shape.note;
            if (!name) {
                name = item.shape._type;
                if (item.shape._type === 'draw') {
                    name = 'drawing';
                }
                else if (item.shape._type === 'unknown') {
                    name = item.shape.subType;
                }
            }
            return name[0].toUpperCase() + name.slice(1);
        },
    },
    area: {
        icon: 'target',
        name: () => 'Area',
    },
    point: {
        icon: 'target',
        name: () => 'Point',
    },
    shapes: {
        icon: 'target',
        name: (item, editor) => {
            const count = item.shapes.length;
            if (count === 1)
                return CONTEXT_TYPE_DEFINITIONS['shape'].name(item, editor);
            return `${count} shapes`;
        },
    },
};
//# sourceMappingURL=ContextItem.js.map