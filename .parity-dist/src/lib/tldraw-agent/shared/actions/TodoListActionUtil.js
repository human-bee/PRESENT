import { z } from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const TodoListAction = z
    .object({
    _type: z.literal('update-todo-list'),
    id: z.number(),
    status: z.enum(['todo', 'in-progress', 'done']),
    text: z.string(),
});
export class TodoListActionUtil extends AgentActionUtil {
    getSchema() {
        return TodoListAction;
    }
    getInfo() {
        // Don't show todo actions in the chat history because we show them in the dedicated todo list UI
        return null;
    }
    applyAction(action) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const todoItem = {
            id: action.id,
            status: action.status,
            text: action.text,
        };
        this.agent.$todoList.update((todoItems) => {
            const index = todoItems.findIndex((item) => item.id === action.id);
            if (index !== -1) {
                return [...todoItems.slice(0, index), todoItem, ...todoItems.slice(index + 1)];
            }
            else {
                return [...todoItems, todoItem];
            }
        });
    }
}
TodoListActionUtil.type = 'update-todo-list';
//# sourceMappingURL=TodoListActionUtil.js.map