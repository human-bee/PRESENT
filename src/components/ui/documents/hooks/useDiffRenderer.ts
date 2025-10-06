type RenderDiffResult = {
  before: string;
  after: string;
};

type RenderDiff = (previous: string, next: string) => RenderDiffResult;

export function useDiffRenderer() {
  const renderDiff: RenderDiff = (previous, next) => ({
    before: previous ?? '',
    after: next ?? '',
  });

  return { renderDiff };
}
