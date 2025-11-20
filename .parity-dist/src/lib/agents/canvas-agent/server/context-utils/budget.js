export const applyTokenBudget = (payload, input) => {
    const estimated = input.transcriptTokens + input.blurryCount * 8 + input.clusterCount * 10;
    if (estimated <= input.maxTokens)
        return payload;
    let { blurry, clusters } = payload;
    let remainder = estimated - input.maxTokens;
    while (remainder > 0 && clusters.length > 0) {
        clusters = clusters.slice(0, clusters.length - 1);
        remainder -= 10;
    }
    while (remainder > 0 && blurry.length > 50) {
        blurry = blurry.slice(0, blurry.length - 25);
        remainder -= 25 * 8;
    }
    return { ...payload, blurry, clusters };
};
//# sourceMappingURL=budget.js.map