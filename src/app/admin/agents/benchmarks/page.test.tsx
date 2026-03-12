import { render, screen } from '@testing-library/react';
import AgentBenchmarksPage from './page';

jest.mock('@/components/admin/benchmark-page-client', () => ({
  BenchmarkPageClient: () => <div data-testid="benchmark-page-client">benchmark-page-client</div>,
}));

describe('/admin/agents/benchmarks page', () => {
  it('renders the client benchmark surface wrapper', async () => {
    render(await AgentBenchmarksPage());

    expect(screen.getByTestId('benchmark-page-client')).toBeTruthy();
  });
});
