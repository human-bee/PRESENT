import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const CountryInfoAction = z
    .object({
    _type: z.literal('countryInfo'),
    code: z.string(),
})
    .meta({
    title: 'Country info',
    description: 'The AI gets information about a country by providing its country code, eg: "de" for Germany.',
});
export class CountryInfoActionUtil extends AgentActionUtil {
    getSchema() {
        return CountryInfoAction;
    }
    getInfo(action) {
        const description = action.complete ? 'Searched for country info' : 'Searching for country info';
        return {
            icon: 'search',
            description,
        };
    }
    async applyAction(action) {
        // Wait until the action has finished streaming
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const data = await fetchCountryInfo(action.code);
        this.agent.schedule({ data: [data] });
    }
}
CountryInfoActionUtil.type = 'countryInfo';
export async function fetchCountryInfo(code) {
    const response = await fetch(`https://restcountries.com/v3.1/alpha/${code}`);
    if (!response.ok) {
        throw new Error(`Country API returned status ${response.status}, ${response.statusText}`);
    }
    const json = await response.json();
    if (Array.isArray(json)) {
        return json[0];
    }
    return json;
}
//# sourceMappingURL=CountryInfoActionUtil.js.map