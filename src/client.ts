import * as readline from 'node:readline/promises';
import {Client, Connection} from '@temporalio/client';
import {chatMessage, endChat, orderAssistantWorkflow} from './workflow.js';

async function runClient() {
    const connection = await Connection.connect();
    const client = new Client({connection});

    const userId = 'user-123';
    const workflowId = `agent-${userId}`;

    // 1. Start the ambient Agent Workflow (or reuse one already running for this user)
    const handle = client.workflow.getHandle(workflowId);
    try {
        await client.workflow.start(orderAssistantWorkflow, {
            args: [userId],
            taskQueue: 'order-agent-queue',
            workflowId,
        });
        console.log(`🤖 Agent Workflow started. ID: ${workflowId}`);
    } catch (err: any) {
        if (err.name !== 'WorkflowExecutionAlreadyStartedError') throw err;
        console.log(`🤖 Reconnected to existing Agent Workflow. ID: ${workflowId}`);
    }

    console.log("💬 Chat with the order assistant. Type 'exit' to quit.\n");

    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    try {
        while (true) {
            const message = (await rl.question('you> ')).trim();
            if (!message) continue;
            if (message === 'exit' || message === 'quit') {
                await handle.signal(endChat);
                console.log('👋 Ending chat session.');
                break;
            }

            // 2. Chat with the agent via a Temporal Update, and print its reply
            const reply = await handle.executeUpdate(chatMessage, {args: [message]});
            console.log(`agent> ${reply}\n`);
        }
    } finally {
        rl.close();
    }
}

runClient().catch(console.error);
