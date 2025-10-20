import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('react-markdown', () => {
  const React = require('react');
  return React.forwardRef(({ children, ...props }: any, ref: React.Ref<HTMLDivElement>) => (
    <div ref={ref} data-testid="react-markdown" {...props}>
      {children}
    </div>
  ));
});

jest.mock('@/components/ui/shared/markdown-components', () => ({
  createMarkdownComponents: () => ({}),
}));

import { Message } from './message';

describe('Message component', () => {
	it('omits updateState when spreading dom props', () => {
		const message = {
			id: 'msg-123',
			content: 'Hello world',
			actionType: 'message',
		} as any;

		render(
			<Message
				role="assistant"
				message={message}
				data-testid="message-root"
				updateState={() => {}}
			>
				<div>Child</div>
			</Message>,
		);

		const node = screen.getByTestId('message-root');
		expect(node.hasAttribute('updateState')).toBe(false);
	});
});
