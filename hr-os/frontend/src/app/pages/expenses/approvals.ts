/** The Inbox decision contexts of the expenses approval kinds. */
import type { ComponentType } from 'react';
import { AdvanceApprovalView, ClaimApprovalView, TravelApprovalView } from '../../components/expenses/ApprovalViews.tsx';
import type { ApprovalViewProps } from '../../lib/contract.ts';

export const ApprovalViews: Record<string, ComponentType<ApprovalViewProps>> = { claim: ClaimApprovalView, advance: AdvanceApprovalView, travel: TravelApprovalView };
