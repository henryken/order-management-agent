import {InMemoryRunner, isFinalResponse, LlmAgent, stringifyContent} from '@google/adk';
import {Type} from '@google/genai';
import {activityAsTool, TemporalModel} from '@temporalio/google-adk-agents/workflow';
import * as wf from '@temporalio/workflow';

// Shared Update/Signal definitions, imported by client.ts too
export const chatMessage = wf.defineUpdate<string, [string]>('chatMessage');
export const endChat = wf.defineSignal('endChat');

// Exposes the getOrderStatusActivity (see activities.ts) as a tool the LLM can call.
const getOrderStatusTool = activityAsTool({
    name: 'getOrderStatusActivity',
    description:
        'Get the current status of an order, given its order ID. ' +
        "Returns {found: true, status: <order status>} if the order exists, or {found: false} if it doesn't.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            // The activity adds the "order-" workflow-ID prefix itself, so the
            // model should only ever pass the bare order ID here.
            orderId: {type: Type.STRING, description: 'The bare order ID, without any prefix.'},
        },
        required: ['orderId'],
    },
    activity: {
        startToCloseTimeout: '10 seconds',
        retry: {maximumAttempts: 2},
    },
});

// Define the Agent Workflow
export async function orderAssistantWorkflow(userId: string): Promise<void> {
    // The ADK Agent definition
    const agent = new LlmAgent({
        name: 'order-assistant',
        // TemporalModel automatically executes LLM calls as retriable Activities
        model: new TemporalModel('gemini-flash'),
        instruction: `
      You are an intelligent order management agent.
    `,
        tools: [getOrderStatusTool],
    });

    const runner = new InMemoryRunner({agent, appName: 'order-app'});
    const session = await runner.sessionService.createSession({appName: 'order-app', userId});

    // Handle incoming user messages via a Temporal Update, so the caller
    // gets the agent's reply back synchronously (a Signal has no return value).
    wf.setHandler(chatMessage, async (message) => {
        // Process the message through the ADK agent loop
        const responseStream = runner.runAsync({
            userId,
            sessionId: session.id,
            newMessage: {role: 'user', parts: [{text: message}]},
        });

        let finalResponse = '';
        for await (const event of responseStream) {
            if (isFinalResponse(event)) {
                finalResponse += stringifyContent(event);
            }
        }

        wf.log.info(`Agent response: ${finalResponse}`);
        return finalResponse;
    });

    // Let the user end the chat session, completing the Workflow.
    let chatEnded = false;
    wf.setHandler(endChat, () => {
        chatEnded = true;
    });

    // Keep the ambient agent alive to keep handling chat Updates until asked to stop.
    await wf.condition(() => chatEnded);
}