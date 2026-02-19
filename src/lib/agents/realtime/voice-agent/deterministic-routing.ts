export const isDeterministicCanvasCommand = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  return (
    /\b(x\s*=\s*-?\d+|y\s*=\s*-?\d+|w\s*=\s*\d+|h\s*=\s*\d+)\b/i.test(trimmed) ||
    /\b(forest-ground|forest-tree-\d+|bunny-(?:body|head|ear(?:-left|-right)?|tail)|sticky-(?:bunny|forest))\b/i.test(
      lower,
    ) ||
    (/\b(multiple\s+fairies?|ground\s+strip|tree\s+trunks?)\b/i.test(lower) &&
      /\b(rectangle|line|ellipse|circle|sticky|shape)\b/i.test(lower))
  );
};
