import {Client, WorkflowNotFoundError} from '@temporalio/client';

const ORDER_WORKFLOW_ID_PREFIX = 'order-';

export type OrderStatusResult = {found: true; status: string} | {found: false};
export type CancelOrderResult = {found: true} | {found: false};
export type ApproveDispatchResult = {found: true} | {found: false};

// Takes the Worker's already-connected Client, so Activities reuse a single
// connection instead of opening a new one on every call.
export function createActivities(client: Client) {
    return {
        async getOrderStatusActivity({orderId}: {orderId: string}): Promise<OrderStatusResult> {
            const handle = client.workflow.getHandle(`${ORDER_WORKFLOW_ID_PREFIX}${orderId}`);
            try {
                const status = await handle.query<string>('getStatus');
                return {found: true, status};
            } catch (err) {
                if (err instanceof WorkflowNotFoundError) {
                    return {found: false};
                }
                throw err;
            }
        },

        async cancelOrderActivity({
            orderId,
            reason,
        }: {
            orderId: string;
            reason: string;
        }): Promise<CancelOrderResult> {
            const handle = client.workflow.getHandle(`${ORDER_WORKFLOW_ID_PREFIX}${orderId}`);
            try {
                await handle.signal('cancelOrder', reason);
                return {found: true};
            } catch (err) {
                if (err instanceof WorkflowNotFoundError) {
                    return {found: false};
                }
                throw err;
            }
        },

        async approveDispatchActivity({
            orderId,
            approverEmail,
        }: {
            orderId: string;
            approverEmail: string;
        }): Promise<ApproveDispatchResult> {
            const handle = client.workflow.getHandle(`${ORDER_WORKFLOW_ID_PREFIX}${orderId}`);
            try {
                await handle.signal('approveDispatch', approverEmail);
                return {found: true};
            } catch (err) {
                if (err instanceof WorkflowNotFoundError) {
                    return {found: false};
                }
                throw err;
            }
        },
    };
}
