import {InMemoryRunner, isFinalResponse, LlmAgent, stringifyContent} from '@google/adk';
import {TemporalModel} from '@temporalio/google-adk-agents/workflow';
import * as wf from '@temporalio/workflow';

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
    });

    const runner = new InMemoryRunner({agent, appName: 'order-app'});
    const session = await runner.sessionService.createSession({appName: 'order-app', userId});

    // Handle incoming user messages via a Temporal Update, so the caller
    // gets the agent's reply back synchronously (a Signal has no return value).
    wf.setHandler(wf.defineUpdate<string, [string]>('chatMessage'), async (message) => {
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
    let endChat = false;
    wf.setHandler(wf.defineSignal('endChat'), () => {
        endChat = true;
    });

    // Keep the ambient agent alive to keep handling chat Updates until asked to stop.
    await wf.condition(() => endChat);
}