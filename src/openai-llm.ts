import {BaseLlm} from '@google/adk';
import type {BaseLlmConnection, LlmRequest, LlmResponse} from '@google/adk';
import type {Content, Part} from '@google/genai';

export interface OpenAiLlmParams {
    model: string;
    baseURL: string;
    apiKey: string;
}

interface OpenAiChatResponse {
    choices?: Array<{
        message?: {content?: string | null};
        finish_reason?: string;
    }>;
}

interface OpenAiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

function partText(part: Part): string {
    if (typeof part.text === 'string') return part.text;
    if (part.functionCall) return `[functionCall: ${part.functionCall.name}]`;
    if (part.functionResponse) return `[functionResponse: ${part.functionResponse.name}]`;
    return '';
}

function partsText(parts: Part[] | undefined): string {
    if (!parts) return '';
    return parts.map(partText).filter(Boolean).join('');
}

function unionText(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(unionText).join('');
    const part = value as Part;
    if (typeof part.text === 'string') return part.text;
    const content = value as Content;
    if (content.parts) return partsText(content.parts);
    return '';
}

function toOpenAiMessages(llmRequest: LlmRequest): OpenAiMessage[] {
    const messages: OpenAiMessage[] = [];

    const systemText = unionText(llmRequest.config?.systemInstruction);
    if (systemText) messages.push({role: 'system', content: systemText});

    for (const content of llmRequest.contents) {
        const text = partsText(content.parts);
        if (!text) continue;
        messages.push({role: content.role === 'model' ? 'assistant' : 'user', content: text});
    }

    return messages;
}

/**
 * A {@link BaseLlm} that talks to any OpenAI-compatible chat completions
 * endpoint instead of the Gemini API.
 */
export class OpenAiLlm extends BaseLlm {
    private readonly baseURL: string;
    private readonly apiKey: string;

    constructor({model, baseURL, apiKey}: OpenAiLlmParams) {
        super({model});
        this.baseURL = baseURL.replace(/\/+$/, '');
        this.apiKey = apiKey;
    }

    override async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
        const config = llmRequest.config;
        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: toOpenAiMessages(llmRequest),
                temperature: config?.temperature,
                max_tokens: config?.maxOutputTokens,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            yield {
                errorCode: String(response.status),
                errorMessage: `OpenAI request failed (${response.status}): ${body}`,
            };
            return;
        }

        const json = (await response.json()) as OpenAiChatResponse;
        const text = json.choices?.[0]?.message?.content ?? '';

        yield {
            content: {role: 'model', parts: [{text}]},
            partial: false,
            turnComplete: true,
        };
    }

    override async connect(): Promise<BaseLlmConnection> {
        throw new Error('OpenAI-compatible LLM does not support live connections.');
    }
}
