import { PromptPartUtil } from './PromptPartUtil';
export class TodoListPartUtil extends PromptPartUtil {
    getPriority() {
        return 10;
    }
    getPart(_request, helpers) {
        return {
            type: 'todoList',
            items: helpers.agent.$todoList.get(),
        };
    }
    buildContent({ items }) {
        if (items.length === 0)
            return [
                'You have no todos yet. Use the `update-todo-list` event with a new id to create a todo.',
            ];
        return [`Here is your current todo list:`, JSON.stringify(items)];
    }
}
TodoListPartUtil.type = 'todoList';
//# sourceMappingURL=TodoListPartUtil.js.map