// One shared Anthropic client. Credentials come from the environment (ANTHROPIC_API_KEY, or
// ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile).
import Anthropic from '@anthropic-ai/sdk';

let client;
export const claude = () => (client ??= new Anthropic());
export { Anthropic };
