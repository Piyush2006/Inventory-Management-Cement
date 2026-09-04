"use client";

import { useState } from "react";
import Link from "next/link";
import { Td } from "@/components/ui";
import { RequestStatusBadge } from "@/components/status-badge";
import { formatNumber, formatDate } from "@/lib/format";
import { RequestActionPanel } from "./[id]/request-action-panel";

type Person = { id: string; name: string };

const ROUTE_OR_ASSIGN_STATUSES = ["ACCEPTED", "PARTIALLY_RECEIVED", "NOT_RECEIVED", "ASSIGNED"];

export function RequestListRow({
  id,
  requestNumber,
  materialName,
  purpose,
  requestType,
  uom,
  quantityRequested,
  requestedByName,
  assignedToName,
  routedToName,
  requiredByDate,
  status,
  canAcceptReject,
  canRoute,
  canAssignOperator,
  isRoutedSupervisor,
  isAssignedOperator,
  isRequester,
  supervisors,
  operators,
  deliveredNotYetReceived,
}: {
  id: string;
  requestNumber: string;
  materialName: string;
  purpose?: string;
  requestType?: string;
  uom: string;
  quantityRequested: number;
  requestedByName: string;
  assignedToName: string | null;
  routedToName: string | null;
  requiredByDate: Date;
  status: string;
  canAcceptReject: boolean;
  canRoute: boolean;
  canAssignOperator: boolean;
  isRoutedSupervisor: boolean;
  isAssignedOperator: boolean;
  isRequester: boolean;
  supervisors: Person[];
  operators: Person[];
  deliveredNotYetReceived: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const canShowRoute = canRoute && ROUTE_OR_ASSIGN_STATUSES.includes(status);
  const canAssign = canAssignOperator && isRoutedSupervisor && ROUTE_OR_ASSIGN_STATUSES.includes(status);
  const hasAction =
    (status === "NEW_REQUEST" && canAcceptReject) ||
    canShowRoute ||
    canAssign ||
    (status === "ASSIGNED" && isAssignedOperator) ||
    (status === "IN_TRANSIT" && isAssignedOperator) ||
    (status === "DELIVERED" && isRequester);

  return (
    <>
      <tr className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
        <Td className="text-xs text-muted-soft">{requestNumber}</Td>
        <Td>{materialName}</Td>
        <Td className="text-xs text-muted">{purpose === "ISSUE" ? "Issue" : "Transfer"}</Td>
        <Td className="text-xs text-muted">{requestType === "SPARE" ? "Spare" : "Material"}</Td>
        <Td className="text-right tabular">{formatNumber(quantityRequested)} {uom}</Td>
        <Td className="text-xs text-muted">{requestedByName}</Td>
        <Td className="text-xs text-muted">{assignedToName ?? (routedToName ? `→ ${routedToName}` : "—")}</Td>
        <Td className="whitespace-nowrap text-xs text-muted">{formatDate(requiredByDate)}</Td>
        <Td><RequestStatusBadge status={status as never} /></Td>
        <Td>
          <div className="flex items-center gap-2">
            {hasAction && (
              <button onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-accent hover:underline">
                {expanded ? "Close" : "Act →"}
              </button>
            )}
            <Link href={`/requests/${id}`} className="text-xs text-muted hover:text-foreground">
              Details
            </Link>
          </div>
        </Td>
      </tr>
      {expanded && (
        <tr className="border-b border-border-soft bg-surface-raised">
          <td colSpan={10} className="px-3 py-3">
            <RequestActionPanel
              requestId={id}
              status={status}
              canAcceptReject={canAcceptReject}
              canRoute={canRoute}
              canAssignOperator={canAssignOperator}
              isRoutedSupervisor={isRoutedSupervisor}
              routedToName={routedToName}
              isAssignedOperator={isAssignedOperator}
              isRequester={isRequester}
              supervisors={supervisors}
              operators={operators}
              deliveredNotYetReceived={deliveredNotYetReceived}
              uom={uom}
            />
          </td>
        </tr>
      )}
    </>
  );
}
